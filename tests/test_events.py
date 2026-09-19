import json

from clinic_voice.infrastructure.events import EventStore


async def test_redaction_replay_and_restart(tmp_path):
    store = EventStore(tmp_path, secrets=["opaque-without-prefix"])
    await store.open()
    await store.emit("C1", "call.started")
    event = await store.emit(
        "C1",
        "api.started",
        authorization="Bearer private",
        body={"national_id": "12345678Z", "email": "ana@example.com", "phone": "612345678"},
    )
    try:
        raise RuntimeError(
            "Bearer private-token: contact ana@example.com key opaque-without-prefix"
        )
    except RuntimeError as exc:
        await store.failure("C1", "tool.failed", exc)
    rows = await store.events(event["id"], "C1")
    assert len(rows) == 1 and rows[0]["data"]["error_type"] == "RuntimeError"
    assert "stack" in rows[0]["data"]
    await store.close()
    text = (tmp_path / "events.jsonl").read_text()
    assert all(
        s not in text for s in ["12345678Z", "612345678", "ana@example.com", "private-token"]
    )
    assert all(json.loads(line)["id"] for line in text.splitlines())
    assert "opaque-without-prefix" not in text
    restarted = EventStore(tmp_path)
    await restarted.open()
    assert (await restarted.calls())[0]["status"] == "interrupted"
    await restarted.close()
