import asyncio
import time

from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.flows import FlowManager
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.workers.runner import WorkerRunner

from clinic_voice.conversation.flow import ClinicFlow
from clinic_voice.voice.observer import CallObserver
from clinic_voice.voice.providers import create_services
from clinic_voice.voice.transport import EvaluatorSerializer
from clinic_voice.voice.turns import ProfiledSmartTurn, ProfiledTimeout, TurnProfiles


async def run_call(websocket, start, tools, settings):
    state, events = tools.state, tools.events
    serializer = EvaluatorSerializer(
        start["streamSid"], params=EvaluatorSerializer.InputParams(auto_hang_up=False)
    )
    transport = FastAPIWebsocketTransport(
        websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
            audio_out_10ms_chunks=2,
            audio_out_auto_silence=False,
            audio_out_end_silence_secs=0,
            add_wav_header=False,
            audio_in_filter=None,
            serializer=serializer,
        ),
    )
    stt, llm, tts = create_services(settings)
    # Each analyzer has mutable per-call state. Construct off-loop, never share it across calls.
    vad = await asyncio.to_thread(
        SileroVADAnalyzer, params=VADParams(start_secs=0.2, stop_secs=0.2)
    )
    profiles = TurnProfiles()
    stops = [ProfiledTimeout(profiles, "dictation", 1.6), ProfiledTimeout(profiles, "waiting", 8.0)]
    if settings.smart_turn_enabled:
        analyzer = await asyncio.to_thread(LocalSmartTurnAnalyzerV3)
        stops.append(ProfiledSmartTurn(profiles, turn_analyzer=analyzer))
    else:
        stops.append(ProfiledTimeout(profiles, "conversation", 0.6))
    aggregator = LLMContextAggregatorPair(
        LLMContext(),
        user_params=LLMUserAggregatorParams(
            vad_analyzer=vad,
            user_turn_strategies=UserTurnStrategies(stop=stops),
            user_turn_stop_timeout=12,
            user_idle_timeout=15,
        ),
    )
    observer = CallObserver(state, events)
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            aggregator.user(),
            llm,
            tts,
            transport.output(),
            aggregator.assistant(),
        ]
    )
    worker = PipelineWorker(
        pipeline,
        conversation_id=state.call_id,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        observers=[observer],
        enable_rtvi=False,
        idle_timeout_secs=60,
        processor_unusable_policy=ProcessorUnusablePolicy.END,
    )
    runner = WorkerRunner(handle_sigint=False)
    serializer.on_stop = runner.cancel
    await runner.add_workers(worker)

    async def set_profile(profile):
        for strategy in stops:
            await strategy.handle_user_turn_stopped()
        profiles.current = profile
        await events.emit(state.call_id, "turn.profile", profile=profile)

    clinic_flow = ClinicFlow(tools, set_profile)
    flow = FlowManager(worker=worker, llm=llm, context_aggregator=aggregator, transport=transport)

    @transport.event_handler("on_client_connected")
    async def connected(transport, client):
        await events.emit(
            state.call_id,
            "pipeline.ready",
            stt=settings.stt_model,
            llm=settings.llm_model,
            tts=settings.tts_model,
            noise_suppression=False,
        )
        await flow.initialize(clinic_flow.node("reception"))

    @transport.event_handler("on_client_disconnected")
    async def disconnected(transport, client):
        await events.emit(state.call_id, "transport.disconnected")
        await runner.cancel()

    @aggregator.user().event_handler("on_user_turn_message_added")
    async def user_message(aggregator, message):
        state.user_turn(message.content)
        observer.last_user_at = time.monotonic()
        await events.emit(
            state.call_id,
            "transcript.user",
            turn=state.turn,
            text=message.content if settings.log_transcripts else "[disabled]",
        )

    @aggregator.assistant().event_handler("on_assistant_turn_stopped")
    async def assistant_message(aggregator, message):
        await events.emit(
            state.call_id,
            "transcript.assistant",
            turn=state.turn,
            text=message.content if settings.log_transcripts else "[disabled]",
            interrupted=message.interrupted,
        )

    @aggregator.user().event_handler("on_user_turn_idle")
    async def idle(aggregator):
        await events.emit(state.call_id, "turn.idle", "warning", profile=profiles.current)

    @worker.event_handler("on_pipeline_error")
    async def error(worker, frame):
        await events.emit(
            state.call_id, "call.failure", "error", message=frame.error, fatal=frame.fatal
        )

    try:
        async with asyncio.timeout(settings.call_timeout_seconds):
            await runner.run()
    finally:
        await runner.cancel()
        await tools.drain()
