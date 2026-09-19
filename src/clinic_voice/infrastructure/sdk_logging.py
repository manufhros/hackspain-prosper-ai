"""Route vendor/framework warnings into the same private, redacted event stream."""

from contextvars import ContextVar

from loguru import logger

call_context = ContextVar("voice_call_id", default="system")


def configure_sdk_logging(events):
    # Pipecat's default DEBUG sink includes raw prompts/transcripts. Disable it.
    logger.remove()

    def annotate(record):
        record["extra"]["voice_call_id"] = call_context.get()
        return True

    async def sink(message):
        record = message.record
        await events.emit(
            record["extra"]["voice_call_id"],
            "sdk.message",
            "error" if record["level"].no >= 40 else "warning",
            component=record["name"],
            message=record["message"],
        )

    return logger.add(sink, level="WARNING", filter=annotate, catch=True)


async def close_sdk_logging(sink_id):
    await logger.complete()
    logger.remove(sink_id)
