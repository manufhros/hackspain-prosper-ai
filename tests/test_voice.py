import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    InterruptionFrame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
)
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.openai.llm import OpenAILLMService

from clinic_voice.domain.state import Proposal
from clinic_voice.voice.observer import CallObserver
from clinic_voice.voice.transport import EvaluatorSerializer


@pytest.mark.parametrize("stt", ["openai", "deepgram"])
@pytest.mark.parametrize("tts", ["elevenlabs", "openai", "cartesia"])
async def test_provider_adapters_construct(stt, tts):
    from clinic_voice.settings import Settings
    from clinic_voice.voice.providers import create_services

    config = Settings(
        _env_file=None,
        stt_provider=stt,
        tts_provider=tts,
        openai_api_key="fake",
        elevenlabs_api_key="fake",
        elevenlabs_voice_id="fake",
        deepgram_api_key="fake",
        cartesia_api_key="fake",
        cartesia_voice_id="fake",
    )
    services = create_services(config)
    assert len(services) == 3
    if stt == "openai":
        assert services[0]._settings.noise_reduction is None


async def test_flow_exposes_commit_only_in_confirmation(harness):
    from clinic_voice.conversation.flow import ClinicFlow

    tools, _, _ = harness
    flow = ClinicFlow(tools, AsyncMock())
    initial = flow.node("reception")
    confirming = flow.node("confirmation")
    assert "commit_action" not in {f.name for f in initial["functions"]}
    assert "commit_action" in {f.name for f in confirming["functions"]}


async def test_interrupted_proposal_requires_respeaking(harness):
    tools, _, _ = harness
    state = tools.state
    state.proposal = Proposal(action="cancel", payload={}, prepared_turn=0, revision=0)
    observer = CallObserver(state, tools.events)
    for frame in [BotStartedSpeakingFrame(), InterruptionFrame(), BotStoppedSpeakingFrame()]:
        await observer.on_push_frame(SimpleNamespace(frame=frame))
    assert not state.proposal.spoken
    for frame in [BotStartedSpeakingFrame(), BotStoppedSpeakingFrame()]:
        await observer.on_push_frame(SimpleNamespace(frame=frame))
    assert state.proposal.spoken


async def test_previous_audio_does_not_confirm_new_proposal(harness):
    tools, _, _ = harness
    observer = CallObserver(tools.state, tools.events)
    await observer.on_push_frame(SimpleNamespace(frame=BotStartedSpeakingFrame()))
    tools.state.proposal = Proposal(action="cancel", payload={}, prepared_turn=0, revision=0)
    await observer.on_push_frame(SimpleNamespace(frame=BotStoppedSpeakingFrame()))
    assert not tools.state.proposal.spoken


async def test_serializer_stop():
    serializer = EvaluatorSerializer(
        "MS1", params=EvaluatorSerializer.InputParams(auto_hang_up=False)
    )
    serializer.on_stop = AsyncMock()
    assert await serializer.deserialize(json.dumps({"event": "stop"})) is None
    serializer.on_stop.assert_awaited_once()


class FakeLLM(OpenAILLMService):
    """Keep real FlowManager/tool registration but emit local PCM instead of calling vendors."""

    async def process_frame(self, frame, direction):
        if isinstance(frame, LLMContextFrame):
            await self.push_frame(LLMFullResponseStartFrame())
            await self.push_frame(TTSStartedFrame())
            await self.push_frame(
                TTSAudioRawFrame(audio=b"\x00\x01" * 4800, sample_rate=24000, num_channels=1)
            )
            await self.push_frame(TTSStoppedFrame())
            await self.push_frame(LLMFullResponseEndFrame())
        else:
            await super().process_frame(frame, direction)


class PassThrough(FrameProcessor):
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)


def test_real_pipecat_pipeline_local_audio(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from clinic_voice.app import create_app
    from clinic_voice.settings import Settings
    from clinic_voice.voice import pipeline

    def services(settings):
        return PassThrough(), FakeLLM(api_key="test-local"), PassThrough()

    monkeypatch.setattr(pipeline, "create_services", services)
    config = Settings(
        _env_file=None,
        data_dir=tmp_path,
        console_token="local",
        transport_token="",
        smart_turn_enabled=False,
        call_timeout_seconds=30,
    )
    app = create_app(config, call_runner=pipeline.run_call)
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json(
                {"event": "start", "start": {"callSid": "local-pipeline", "streamSid": "MS1"}}
            )
            message = ws.receive_json()
            assert message["event"] == "media", message
            assert message["streamSid"] == "MS1"
            assert message["media"]["payload"]
            ws.send_json({"event": "stop"})
            with pytest.raises(WebSocketDisconnect):
                while True:
                    ws.receive_json()
        for _ in range(100):
            events = client.get(
                "/console/api/events?call_id=local-pipeline",
                headers={"Authorization": "Bearer local"},
            ).json()["events"]
            if any(e["kind"] == "call.ended" for e in events):
                break
            time.sleep(0.02)
        assert any(e["kind"] == "call.ended" for e in events), events
        failures = [
            e for e in events if e["kind"] in {"pipeline.error", "call.failure", "call.failed"}
        ]
        assert not failures, failures
        assert any(e["kind"] == "pipeline.ready" for e in events)
