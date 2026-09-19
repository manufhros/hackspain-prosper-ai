import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from clinic_voice.app import create_app
from clinic_voice.settings import Settings


def settings(tmp_path, **kwargs):
    return Settings(
        _env_file=None,
        data_dir=tmp_path,
        console_token="test-console",
        transport_token="test-wire",
        **kwargs,
    )


def start(call_id):
    return {
        "event": "start",
        "start": {
            "callSid": call_id,
            "streamSid": "M-" + call_id,
            "customParameters": {"call_id": "WRONG"},
            "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1},
        },
    }


async def runner(ws, start, tools, settings):
    await ws.send_json({"ready": tools.state.call_id})
    await ws.receive_json()
    await tools.report_outcome("no-action", "out_of_scope")


def test_console_auth_and_wire_authoritative_id(tmp_path):
    app = create_app(
        settings(tmp_path),
        call_runner=runner,
        http_transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"ok": True})),
    )
    with TestClient(app) as client:
        assert client.get("/console").status_code == 200
        assert client.get("/console/assets/app.js").status_code == 200
        assert client.get("/console/api/calls").status_code == 401
        headers = {"Authorization": "Bearer test-console"}
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws"):
                pass
        with client.websocket_connect("/ws", headers={"Authorization": "Bearer test-wire"}) as ws:
            ws.send_json({"event": "connected"})
            ws.send_json(start("C1"))
            assert ws.receive_json() == {"ready": "C1"}
            calls = client.get("/console/api/calls", headers=headers).json()["calls"]
            assert calls[0]["status"] == "active"
            ws.send_json({"done": True})
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()
        calls = client.get("/console/api/calls", headers=headers).json()["calls"]
        assert calls[0]["call_id"] == "C1"
        assert calls[0]["status"] == "completed"
        assert calls[0]["actions"] == 1
        rows = client.get("/console/api/events?call_id=C1", headers=headers).json()["events"]
        assert any(r["kind"] == "api.started" for r in rows)
        assert not client.get(
            "/console/api/events?after=" + str(rows[-1]["id"]), headers=headers
        ).json()["events"]
        assert "test-wire" not in json.dumps(rows)


def test_twenty_sessions_isolated(tmp_path):
    app = create_app(
        settings(tmp_path),
        call_runner=runner,
        http_transport=httpx.MockTransport(lambda _: httpx.Response(200, json={})),
    )
    barrier = Barrier(20)
    with TestClient(app) as client:

        def call(i):
            with client.websocket_connect(
                "/ws", headers={"Authorization": "Bearer test-wire"}
            ) as ws:
                ws.send_json(start(f"C{i}"))
                assert ws.receive_json()["ready"] == f"C{i}"
                barrier.wait(timeout=15)
                ws.send_json({"done": True})
                with pytest.raises(WebSocketDisconnect):
                    ws.receive_json()

        with ThreadPoolExecutor(max_workers=20) as executor:
            list(executor.map(call, range(20)))
        assert client.get("/health").json()["active_calls"] == 0
        calls = client.get(
            "/console/api/calls", headers={"Authorization": "Bearer test-console"}
        ).json()["calls"]
        assert len(calls) == 20
        assert all(c["actions"] == 1 and c["status"] == "completed" for c in calls)


def test_bad_handshake_releases_capacity(tmp_path):
    app = create_app(settings(tmp_path), call_runner=runner)
    with TestClient(app) as client:
        with client.websocket_connect("/ws", headers={"Authorization": "Bearer test-wire"}) as ws:
            ws.send_json({"event": "media"})
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()
        assert client.get("/health").json()["active_calls"] == 0
