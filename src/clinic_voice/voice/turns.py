from pipecat.frames.frames import StartFrame, STTMetadataFrame
from pipecat.turns.types import ProcessFrameResult
from pipecat.turns.user_stop.speech_timeout_user_turn_stop_strategy import (
    SpeechTimeoutUserTurnStopStrategy,
)
from pipecat.turns.user_stop.turn_analyzer_user_turn_stop_strategy import (
    TurnAnalyzerUserTurnStopStrategy,
)


class TurnProfiles:
    def __init__(self):
        self.current = "conversation"


class ProfiledSmartTurn(TurnAnalyzerUserTurnStopStrategy):
    def __init__(self, profiles, **kwargs):
        super().__init__(**kwargs)
        self.profiles = profiles

    async def process_frame(self, frame):
        if self.profiles.current == "conversation" or isinstance(
            frame, (StartFrame, STTMetadataFrame)
        ):
            return await super().process_frame(frame)
        return ProcessFrameResult.CONTINUE


class ProfiledTimeout(SpeechTimeoutUserTurnStopStrategy):
    def __init__(self, profiles, profile, timeout):
        super().__init__(user_speech_timeout=timeout)
        self.profiles, self.profile = profiles, profile

    async def process_frame(self, frame):
        if self.profiles.current == self.profile or isinstance(
            frame, (StartFrame, STTMetadataFrame)
        ):
            return await super().process_frame(frame)
        return ProcessFrameResult.CONTINUE
