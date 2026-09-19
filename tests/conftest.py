from datetime import date

import httpx
import pytest

from clinic_voice.application.tools import ClinicTools
from clinic_voice.domain.state import CallState
from clinic_voice.infrastructure.events import EventStore
from clinic_voice.integrations.prosper import ProsperClient


@pytest.fixture
async def harness(tmp_path):
    events = EventStore(tmp_path)
    await events.open()
    requests = []
    responses = {}

    def respond(request):
        requests.append(request)
        result = responses.get(request.url.path, {})
        if isinstance(result, Exception):
            raise result
        if isinstance(result, httpx.Response):
            return result
        return httpx.Response(200, json=result)

    async with httpx.AsyncClient(
        base_url="https://mock.invalid", transport=httpx.MockTransport(respond)
    ) as http:
        state = CallState(call_id="C-test", today=date(2026, 9, 19))
        state.patient_id = "P1"
        state.verified["P1"] = {"patient_id": "P1", "name": "Ana Garcia", "insurer": "sanitas"}
        client = ProsperClient(http, events, state.call_id)
        tools = ClinicTools(
            state, client, events, {"calendar": {"starts": "2026-09-07", "ends": "2026-10-16"}}
        )
        yield tools, responses, requests
        await tools.drain()
    await events.close()


def slot(hour=10, **kwargs):
    return {
        "provider_id": "doctor1",
        "location_id": "centro",
        "start_time": f"2026-09-21T{hour:02}:00:00+02:00",
        "appointment_type_id": "dermatology_review",
        "payable_with": ["sanitas"],
        **kwargs,
    }
