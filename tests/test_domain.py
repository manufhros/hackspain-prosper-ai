import json
from datetime import UTC, datetime

import httpx
import pytest
from conftest import slot

from clinic_voice.application.tools import affirmative, birth_date_heard, location, specialty
from clinic_voice.domain.state import DomainError, Registration, clinic_today
from clinic_voice.integrations.prosper import ProsperError


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Sí, por favor.", True),
        ("Yes!", True),
        ("D'acord", True),
        ("Sí pero a las cinco", False),
        ("No", False),
        ("Yes at five", False),
        ("Si hay otra hora", False),
    ],
)
def test_consent(text, expected):
    assert affirmative(text) is expected


def test_dates():
    now = datetime(2026, 9, 19, 5, tzinfo=UTC)
    assert str(clinic_today(now, "call_date")) == "2026-09-19"
    assert str(clinic_today(now, "lucia_9am")) == "2026-09-18"
    assert birth_date_heard("1985-03-12", ["12 de marzo de 1985"])
    assert not birth_date_heard("1985-03-12", ["hola"])


def test_lucia_aliases_retained():
    assert location("SIR") == "sur"
    assert location("Central Arnold") == "centro"
    assert location("Arenal Sur") == "sur"
    assert specialty("General Practice") == "general_practice"
    assert specialty("pediatric") == "paediatrics"


async def test_identity_requires_caller_evidence_and_hides_identifiers(harness):
    tools, responses, _ = harness
    responses["/api/v1/directory"] = {
        "matches": [
            {
                "patient_id": "P2",
                "name": "Ana",
                "phone": "612345678",
                "national_id": "12345678Z",
                "date_of_birth": "1985-03-12",
                "insurer": "sanitas",
            }
        ]
    }
    tools.state.from_number = "612345678"
    tools.state.user_turn("Soy Ana")
    result = await tools.search_directory("Ana", phone="612345678")
    assert result["verified_patient_id"] is None
    assert "phone" not in result["matches"][0]
    assert "national_id" not in result["matches"][0]
    assert (await tools.search_directory("Ana", date_of_birth="1985-03-12"))[
        "verified_patient_id"
    ] is None
    tools.state.user_turn("Nací el 12 de marzo de 1985")
    assert (await tools.search_directory("Ana", date_of_birth="1985-03-12"))[
        "verified_patient_id"
    ] == "P2"


async def test_offer_filters_and_exact_type(harness):
    tools, responses, requests = harness
    responses["/api/v1/availability"] = {"slots": [slot(14), slot(9), slot(12)]}
    result = await tools.search_availability(specialty_id="dermatology", time_of_day="morning")
    assert len(result["offers"]) == 2
    assert result["offers"][0]["start_time"].endswith("09:00:00+02:00")
    assert requests[-1].url.params["patient_id"] == "P1"
    proposal = await tools.prepare_action("book", offer_ref=result["offers"][0]["offer_ref"])
    assert proposal["details"]["appointment_type_id"] == "dermatology_review"
    with pytest.raises(DomainError, match="NEW"):
        await tools.commit_action(proposal["proposal_id"], "Sí")
    tools.state.proposal.spoken = True
    tools.state.user_turn("Sí, por favor")
    result = await tools.commit_action(proposal["proposal_id"], "Sí")
    assert result["action"] == "book"
    assert json.loads(requests[-1].content)["call_id"] == "C-test"


async def test_corrections_cannot_commit_and_stale_ids_fail(harness):
    tools, responses, _ = harness
    responses["/api/v1/availability"] = {"slots": [slot()]}
    offers = await tools.search_availability()
    proposal = await tools.prepare_action("book", offer_ref=offers["offers"][0]["offer_ref"])
    tools.state.proposal.spoken = True
    tools.state.user_turn("Sí, pero mejor por la tarde")
    with pytest.raises(DomainError, match="unambiguous"):
        await tools.commit_action(proposal["proposal_id"], "Sí")
    await tools.revise_request()
    with pytest.raises(DomainError, match="expired"):
        await tools.commit_action(proposal["proposal_id"], "Sí")
    with pytest.raises(DomainError, match="Unknown/stale"):
        await tools.prepare_action("book", offer_ref=offers["offers"][0]["offer_ref"])


async def test_two_cancels_same_call_and_dedup(harness):
    tools, responses, requests = harness
    responses["/api/v1/patients/P1/appointments"] = {
        "appointments": [
            {
                "appointment_id": f"A{i}",
                "patient_id": "P1",
                "start_time": "2026-09-22T10:00:00+02:00",
            }
            for i in (1, 2)
        ]
    }
    await tools.list_appointments()
    for i in (1, 2):
        proposal = await tools.prepare_action("cancel", appointment_id=f"A{i}")
        tools.state.proposal.spoken = True
        tools.state.user_turn("Yes")
        await tools.commit_action(proposal["proposal_id"], "Yes")
    assert len(tools.state.actions) == 2
    await tools._submit("cancel", {"appointment_id": "A1"})
    assert len([r for r in requests if r.method == "POST"]) == 2
    with pytest.raises(DomainError):
        await tools.report_outcome("no-action", "out_of_scope")


async def test_other_patient_cannot_use_cached_offer(harness):
    tools, responses, _ = harness
    responses["/api/v1/availability"] = {"slots": [slot()]}
    offers = await tools.search_availability()
    tools.state.patient_id = "P2"
    tools.state.verified["P2"] = {"patient_id": "P2", "insurer": "sanitas"}
    with pytest.raises(DomainError):
        await tools.prepare_action("book", offer_ref=offers["offers"][0]["offer_ref"])


async def test_second_policy_must_be_heard(harness):
    tools, _, requests = harness
    with pytest.raises(DomainError, match="second policy"):
        await tools.search_availability(policy_id="privado")
    tools.state.user_turn("También tengo Adeslas")
    await tools.search_availability(policy_id="adeslas")
    assert requests[-1].url.params["insurer"] == "adeslas"


async def test_window_guard_and_future_only(harness):
    tools, responses, _ = harness
    with pytest.raises(DomainError):
        await tools.search_availability(date_from="2026-09-20", date_to="2026-10-16")
    responses["/api/v1/availability"] = {
        "slots": [slot(start_time="2026-09-19T12:00:00+02:00"), slot(14)]
    }
    result = await tools.search_availability(time_of_day="afternoon")
    assert len(result["offers"]) == 1


@pytest.mark.parametrize(
    "status,accepted,unknown",
    [(200, True, False), (409, True, False), (422, False, False), (503, False, True)],
)
async def test_submit_receipt_semantics(harness, status, accepted, unknown):
    tools, responses, _ = harness
    responses["/api/v1/submit/escalate"] = httpx.Response(status, json={"detail": "mock"})
    if accepted:
        await tools.report_outcome("escalate", "medical_emergency")
    else:
        with pytest.raises(ProsperError):
            await tools.report_outcome("escalate", "medical_emergency")
    assert bool(tools.state.actions) is accepted
    assert bool(tools.unknown) is unknown


async def test_ambiguous_network_failure_never_retried(harness):
    tools, responses, requests = harness
    responses["/api/v1/submit/escalate"] = httpx.ReadTimeout("lost receipt")
    with pytest.raises(httpx.ReadTimeout):
        await tools.report_outcome("escalate", "medical_emergency")
    with pytest.raises(DomainError, match="unknown"):
        await tools.report_outcome("escalate", "medical_emergency")
    assert len(requests) == 1
    assert not tools.state.actions


def test_registration_checks_id_and_fields():
    data = dict(
        given_name="Ana",
        first_surname="García",
        second_surname="Soler",
        national_id="12345678Z",
        date_of_birth="1985-03-12",
        phone="612345678",
        email="ana@example.com",
        insurer="sanitas",
    )
    assert Registration(**data).national_id == "12345678Z"
    with pytest.raises(ValueError):
        Registration(**{**data, "national_id": "12345678A"})
    with pytest.raises(ValueError):
        Registration(**{**data, "phone": "612"})
