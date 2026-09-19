"""Opt-in paid vendor smoke. No requests are ever sent to the Prosper platform."""

import os
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from clinic_voice.app import create_app
from clinic_voice.settings import Settings


@pytest.mark.skipif(
    os.getenv("RUN_LIVE_VOICE_SMOKE") != "1", reason="Opt-in vendor calls (billable)"
)
def test_live_greeting(tmp_path):
    from clinic_voice.voice.pipeline import run_call

    config = Settings(
        data_dir=tmp_path, transport_token="", console_token="local-smoke", call_timeout_seconds=30
    )
    assert not config.missing_credentials(), config.missing_credentials()

    def reject_platform(request):
        raise AssertionError("Live smoke must not call or submit to Prosper")

    app = create_app(
        config, call_runner=run_call, http_transport=httpx.MockTransport(reject_platform)
    )
    started = time.monotonic()
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json(
                {
                    "event": "start",
                    "start": {"callSid": "synthetic-live-smoke", "streamSid": "MS-smoke"},
                }
            )
            try:
                while True:
                    message = ws.receive_json()
                    if message.get("event") == "media":
                        break
            except WebSocketDisconnect:
                rows = client.get(
                    "/console/api/events", headers={"Authorization": "Bearer local-smoke"}
                ).json()["events"]
                pytest.fail(str([r for r in rows if r["level"] == "error"]))
            assert message["media"]["payload"]
            print(
                f"Live provider first audio in {time.monotonic() - started:.2f}s (includes cold start)"
            )
            ws.send_json({"event": "stop"})
            with pytest.raises(WebSocketDisconnect):
                while True:
                    ws.receive_json()
        for _ in range(150):
            rows = client.get(
                "/console/api/events", headers={"Authorization": "Bearer local-smoke"}
            ).json()["events"]
            if any(r["kind"] == "call.ended" for r in rows):
                break
            time.sleep(0.02)
        failures = [r for r in rows if r["level"] == "error" and r["kind"] != "call.missing_record"]
        assert not failures, failures
        assert any(r["kind"] == "call.ended" for r in rows)
