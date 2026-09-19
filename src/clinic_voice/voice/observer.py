import time
from collections import deque

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    InterruptionFrame,
    LLMFullResponseStartFrame,
    MetricsFrame,
)
from pipecat.observers.base_observer import BaseObserver


class CallObserver(BaseObserver):
    def __init__(self, state, events):
        super().__init__()
        self.state, self.events = state, events
        self.seen = set()
        self.order = deque()
        self.last_user_at = None
        self.speaking_proposal = None

    async def on_push_frame(self, data):
        frame = data.frame
        if not isinstance(
            frame,
            (
                BotStartedSpeakingFrame,
                BotStoppedSpeakingFrame,
                ErrorFrame,
                InterruptionFrame,
                LLMFullResponseStartFrame,
                MetricsFrame,
            ),
        ):
            return
        if frame.id in self.seen:
            return
        self.seen.add(frame.id)
        self.order.append(frame.id)
        if len(self.order) > 2048:
            self.seen.discard(self.order.popleft())
        call_id = self.state.call_id
        if isinstance(frame, BotStartedSpeakingFrame):
            self.state.speaking = True
            self.state.interrupted = False
            self.speaking_proposal = self.state.proposal.id if self.state.proposal else None
            await self.events.emit(
                call_id,
                "audio.started",
                turn=self.state.turn,
                response_latency_ms=round((time.monotonic() - self.last_user_at) * 1000)
                if self.last_user_at
                else None,
            )
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self.state.speaking = False
            if (
                self.state.proposal
                and self.state.proposal.id == self.speaking_proposal
                and not self.state.interrupted
            ):
                self.state.proposal.spoken = True
            await self.events.emit(
                call_id,
                "audio.stopped",
                interrupted=self.state.interrupted,
                playback="transport-paced estimate; evaluator does not acknowledge playback",
            )
        elif isinstance(frame, InterruptionFrame):
            if self.state.speaking:
                self.state.interrupted = True
                if self.state.proposal:
                    self.state.proposal.spoken = False
                await self.events.emit(call_id, "audio.interrupted", turn=self.state.turn)
        elif isinstance(frame, MetricsFrame):
            await self.events.emit(
                call_id, "pipeline.metrics", metrics=[m.model_dump() for m in frame.data]
            )
        elif isinstance(frame, ErrorFrame):
            await self.events.emit(
                call_id,
                "pipeline.error",
                "error",
                component=str(data.source),
                message=frame.error,
                fatal=frame.fatal,
            )
        else:
            await self.events.emit(call_id, "llm.started", turn=self.state.turn)
