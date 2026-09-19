import asyncio
import time
from uuid import uuid4

import httpx

from clinic_voice.infrastructure.events import EventStore


class ProsperError(Exception):
    def __init__(self, status: int, detail):
        self.status = status
        self.detail = detail
        super().__init__(f"Prosper HTTP {status}: {detail}")


class ProsperClient:
    def __init__(self, http: httpx.AsyncClient, events: EventStore, call_id: str):
        self.http, self.events, self.call_id = http, events, call_id

    async def request(self, method: str, path: str, *, params=None, body=None):
        request_id = uuid4().hex[:12]
        # Writes have an explicit unknown state on ambiguous failures; never blindly retry.
        for attempt in range(1, 4 if method == "GET" else 2):
            start = time.monotonic()
            await self.events.emit(
                self.call_id,
                "api.started",
                request_id=request_id,
                method=method,
                path=path,
                query=params,
                body=body,
                attempt=attempt,
            )
            try:
                response = await self.http.request(method, path, params=params, json=body)
                try:
                    payload = response.json()
                except ValueError:
                    payload = {"message": response.text[:1000]}
                    if response.is_success:
                        raise ValueError("Prosper returned a non-JSON success response") from None
                await self.events.emit(
                    self.call_id,
                    "api.completed",
                    request_id=request_id,
                    method=method,
                    path=path,
                    status=response.status_code,
                    duration_ms=round((time.monotonic() - start) * 1000),
                    response=payload,
                )
                if response.is_success:
                    return payload
                if method == "GET" and response.status_code in {429, 502, 503} and attempt < 3:
                    await asyncio.sleep(0.15 * 2 ** (attempt - 1))
                    continue
                raise ProsperError(response.status_code, payload)
            except Exception as exc:
                await self.events.failure(
                    self.call_id,
                    "api.failed",
                    exc,
                    request_id=request_id,
                    method=method,
                    path=path,
                    duration_ms=round((time.monotonic() - start) * 1000),
                )
                raise

    async def directory(self, query):
        return await self.request("GET", "/api/v1/directory", params=query)

    async def availability(self, query):
        return await self.request("GET", "/api/v1/availability", params=query)

    async def appointments(self, patient_id, when="upcoming"):
        return await self.request(
            "GET", f"/api/v1/patients/{patient_id}/appointments", params={"when": when}
        )

    async def submit(self, action, payload):
        return await self.request(
            "POST", f"/api/v1/submit/{action}", body={"call_id": self.call_id, **payload}
        )
