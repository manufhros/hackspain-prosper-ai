import json

from pipecat.serializers.twilio import TwilioFrameSerializer


class EvaluatorSerializer(TwilioFrameSerializer):
    """Twilio wire format without a Twilio account; honor evaluator stop events."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_stop = None

    async def deserialize(self, data):
        if json.loads(data).get("event") == "stop":
            if self.on_stop:
                await self.on_stop()
            return None
        return await super().deserialize(data)
