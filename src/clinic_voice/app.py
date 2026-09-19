import asyncio
import hmac
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from clinic_voice.application.tools import ClinicTools
from clinic_voice.domain.state import CallState, clinic_today
from clinic_voice.infrastructure.events import EventStore
from clinic_voice.infrastructure.sdk_logging import (
    call_context,
    close_sdk_logging,
    configure_sdk_logging,
)
from clinic_voice.integrations.geocoder import Geocoder
from clinic_voice.integrations.prosper import ProsperClient
from clinic_voice.settings import Settings

STATIC = Path(__file__).parent / "console"


def create_app(settings: Settings | None = None, *, call_runner=None, http_transport=None):
    settings = settings or Settings()
    events = EventStore(
        settings.data_dir,
        secrets=[
            settings.value(name)
            for name in type(settings).model_fields
            if name.endswith(("_api_key", "_token"))
        ],
    )
    active: dict[str, asyncio.Task] = {}
    cleanups: set[asyncio.Task] = set()
    catalog = {}
    catalog_lock = asyncio.Lock()
    geocoder = Geocoder(settings.geocoder_url)

    @asynccontextmanager
    async def lifespan(app):
        await events.open()
        sink_id = configure_sdk_logging(events)
        async with httpx.AsyncClient(
            base_url=settings.platform_api_base_url,
            headers={"X-Api-Key": settings.value("platform_api_key")},
            timeout=httpx.Timeout(10, connect=5),
            limits=httpx.Limits(max_connections=80),
            transport=http_transport,
        ) as client:
            app.state.http = client
            app.state.events = events
            app.state.active = active
            await events.emit(
                "system",
                "server.started",
                noise_suppression=False,
                missing_credentials=settings.missing_credentials(),
                max_calls=settings.max_calls,
            )
            yield
            for task in list(active.values()):
                task.cancel()
            if active:
                await asyncio.gather(*list(active.values()), return_exceptions=True)
            if cleanups:
                await asyncio.gather(*list(cleanups), return_exceptions=True)
        await close_sdk_logging(sink_id)
        await events.close()

    app = FastAPI(title="Clínica Arenal Voice v1", lifespan=lifespan)
    app.mount("/console/assets", StaticFiles(directory=STATIC), name="console-assets")

    async def console_auth(authorization: str = Header("")):
        token = settings.value("console_token")
        if not token:
            raise HTTPException(503, "Configure CONSOLE_TOKEN to enable the private console")
        if not hmac.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(401, "Invalid console token")

    @app.get("/health")
    async def health():
        return {"ok": True, "active_calls": len(active)}

    @app.get("/ready")
    async def ready():
        missing = settings.missing_credentials()
        if missing:
            raise HTTPException(503, {"missing": missing})
        return {"configured": True, "note": "Credentials present; provider connectivity not probed"}

    @app.get("/", include_in_schema=False)
    @app.get("/console", include_in_schema=False)
    async def console():
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})

    @app.get("/console/api/calls", dependencies=[Depends(console_auth)])
    async def calls():
        return {"calls": await events.calls()}

    @app.get("/console/api/events", dependencies=[Depends(console_auth)])
    async def history(call_id: str | None = None, after: int = Query(0, ge=0)):
        return {"events": await events.events(after, call_id)}

    @app.get("/console/api/stream", dependencies=[Depends(console_auth)])
    async def stream(after: int = Query(0, ge=0)):
        async def generate():
            cursor = after
            while True:
                rows = await events.events(cursor)
                for row in rows:
                    cursor = row["id"]
                    yield f"id: {cursor}\ndata: {json.dumps(row)}\n\n"
                if not rows:
                    yield ": heartbeat\n\n"
                    await asyncio.sleep(1)

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    @app.get("/console/api/config", dependencies=[Depends(console_auth)])
    async def config():
        return {
            "stt": f"{settings.stt_provider}/{settings.stt_model}",
            "llm": settings.llm_model,
            "tts": f"{settings.tts_provider}/{settings.tts_model}",
            "noise_suppression": False,
            "clock_mode": settings.clock_mode,
            "missing_credentials": settings.missing_credentials(),
        }

    @app.websocket("/ws")
    async def inbound(ws: WebSocket):
        token = settings.value("transport_token")
        if token and not hmac.compare_digest(
            ws.headers.get("authorization", ""), f"Bearer {token}"
        ):
            await ws.close(code=1008)
            return
        if len(active) >= settings.max_calls:
            await ws.close(code=1013)
            return
        # Reserve capacity before accepting/awaiting the handshake (burst-safe).
        reservation = f"pending-{uuid4().hex}"
        active[reservation] = asyncio.current_task()
        call_id = reservation
        started = False
        owned_id = reservation
        context_token = call_context.set(reservation)
        tools = None
        status = "ended"
        try:
            await ws.accept()
            async with asyncio.timeout(10):
                while True:
                    raw = await ws.receive_text()
                    if len(raw) > 16384:
                        raise ValueError("Oversized handshake")
                    message = json.loads(raw)
                    if message.get("event") == "connected":
                        continue
                    if message.get("event") != "start":
                        raise ValueError("Expected Twilio start")
                    start = message["start"]
                    break
            call_id = start.get("callSid")
            if not isinstance(call_id, str) or not 1 <= len(call_id) <= 200:
                raise ValueError("Invalid callSid")
            if not isinstance(start.get("streamSid"), str) or not start["streamSid"]:
                raise ValueError("Invalid streamSid")
            if call_id in active:
                raise ValueError("Duplicate active callSid")
            fmt = start.get("mediaFormat", {})
            if fmt and (
                fmt.get("encoding") != "audio/x-mulaw"
                or int(fmt.get("sampleRate", 0)) != 8000
                or int(fmt.get("channels", 0)) != 1
            ):
                raise ValueError("Expected mono 8kHz audio/x-mulaw")
            active[call_id] = active.pop(reservation)
            owned_id = call_id
            call_context.set(call_id)
            now = datetime.now(UTC)
            state = CallState(
                call_id=call_id,
                connected_at=now,
                today=clinic_today(now, settings.clock_mode),
                from_number=start.get("customParameters", {}).get("from_number", ""),
            )
            await events.emit(
                call_id,
                "call.started",
                today=str(state.today),
                clock_mode=settings.clock_mode,
                stream_sid=start["streamSid"],
                caller_id_present=bool(state.from_number),
            )
            started = True
            client = ProsperClient(app.state.http, events, call_id)
            if not call_runner:
                missing = settings.missing_credentials()
                if missing:
                    raise ValueError(f"Missing credentials: {', '.join(missing)}")
                async with catalog_lock:
                    if not catalog:
                        catalog.update(await client.request("GET", "/api/v1/clinic"))
            tools = ClinicTools(state, client, events, catalog, geocoder.lookup)
            if call_runner:
                await call_runner(ws, start, tools, settings)
            else:
                from clinic_voice.voice.pipeline import run_call

                await run_call(ws, start, tools, settings)
            if not state.actions:
                status = "missing_record"
                await events.emit(
                    call_id,
                    "call.missing_record",
                    "error",
                    message="Call ended with no accepted action; no fabricated fallback submitted",
                )
            else:
                status = "completed"
        except WebSocketDisconnect:
            status = "disconnected"
        except asyncio.CancelledError:
            status = "interrupted"
            raise
        except Exception as exc:
            status = "failed"
            await events.failure(call_id or reservation, "call.failed", exc)
        finally:

            async def finalize():
                try:
                    if tools:
                        try:
                            await tools.drain()
                        except Exception as exc:
                            await events.failure(call_id, "operation.drain_failed", exc)
                    if started:
                        await events.emit(
                            call_id,
                            "call.ended",
                            status=status,
                            actions=len(tools.state.actions) if tools else 0,
                            unknown_operations=len(tools.unknown) if tools else 0,
                        )
                finally:
                    # Do not remove another session on a rejected duplicate handshake.
                    active.pop(reservation, None)
                    active.pop(owned_id, None)
                    try:
                        await ws.close()
                    except (RuntimeError, WebSocketDisconnect):
                        pass

            cleanup = asyncio.create_task(finalize())
            cleanups.add(cleanup)
            cleanup.add_done_callback(cleanups.discard)
            try:
                await asyncio.shield(cleanup)
            finally:
                call_context.reset(context_token)

    return app


app = create_app()
