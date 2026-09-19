"""Verified clinic operations, independent of Pipecat and model vendors."""

import asyncio
import hashlib
import json
import math
import re
import time
import unicodedata
from datetime import date, datetime, timedelta
from uuid import uuid4

from clinic_voice.domain.state import (
    INSURERS,
    MADRID,
    CallState,
    DomainError,
    Proposal,
    Reason,
    Registration,
)
from clinic_voice.infrastructure.events import EventStore
from clinic_voice.integrations.prosper import ProsperClient, ProsperError


def fold(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c)
    )


def location(value: str | None):
    aliases = {
        "central": "centro",
        "center": "centro",
        "centre": "centro",
        "south": "sur",
        "getafe": "sur",
        "north": "norte",
        "sir": "sur",
        "rnl": "sur",
        "arnold": "centro",
        "central arnold": "centro",
    }
    if value:
        value = fold(value).replace("arenal ", "").strip()
    return aliases.get(value, value)


def specialty(value: str | None):
    aliases = {
        "orthopedics": "orthopaedics",
        "orthopedic": "orthopaedics",
        "traumatology": "orthopaedics",
        "traumatologia": "orthopaedics",
        "gynecology": "gynaecology",
        "pediatrics": "paediatrics",
        "pediatric": "paediatrics",
        "gp": "general_practice",
    }
    if value:
        value = re.sub(r"\s+", "_", fold(value).strip())
    return aliases.get(value, value)


def affirmative(text: str) -> bool:
    text = fold(text)
    if re.search(r"\b(no|not|but|pero|espera|wait|instead|mejor|cambio|except|don't|dont)\b", text):
        return False
    # Standalone assent only: "yes, at five" requires a new proposal.
    text = re.sub(r"[.!?,;]", "", text).strip()
    return bool(
        re.fullmatch(
            r"(?:(?:si|yes|yeah|yep|vale|correcto|correcta|confirmo|confirm|confirmed|adelante|okay|ok|please|por favor|d'acord|bai|perfecto|perfect|that's right|that is right|sounds good|eso es|de acuerdo|sure|go ahead|hazlo)\s*)+",
            text,
        )
    )


def birth_date_heard(value: str, transcripts) -> bool:
    """Accept numeric dates or spoken month names; never equate any utterance with DOB evidence."""
    try:
        dob = date.fromisoformat(value)
    except ValueError:
        return False
    months = (
        "enero january gener xaneiro",
        "febrero february febrer febreiro",
        "marzo march marc marco",
        "abril april",
        "mayo may maig maio",
        "junio june juny xuno",
        "julio july juliol xullo",
        "agosto august agost",
        "septiembre september setembre setembro",
        "octubre october outubro",
        "noviembre november novembre novembro",
        "diciembre december desembre decembro",
    )
    for text in transcripts:
        text = fold(text)
        numbers = [int(n) for n in re.findall(r"\d+", text)]
        if all(n in numbers for n in (dob.day, dob.month, dob.year)):
            return True
        if (
            dob.day in numbers
            and dob.year in numbers
            and any(re.search(rf"\b{m}\b", text) for m in months[dob.month - 1].split())
        ):
            return True
    return False


class ClinicTools:
    def __init__(
        self,
        state: CallState,
        client: ProsperClient,
        events: EventStore,
        catalog: dict,
        geocoder=None,
    ):
        self.state, self.client, self.events, self.catalog = state, client, events, catalog
        self.lock = asyncio.Lock()
        self.inflight: set[asyncio.Task] = set()
        self.results: dict[str, dict] = {}
        self.unknown: set[str] = set()
        self.geocoder = geocoder

    async def invoke(self, name: str, args: dict):
        tool_id, started = uuid4().hex[:12], time.monotonic()
        await self.events.emit(
            self.state.call_id,
            "tool.started",
            tool_id=tool_id,
            name=name,
            arguments=args,
            turn=self.state.turn,
        )
        try:
            method = getattr(self, name, None)
            if not method or name.startswith("_") or name not in TOOL_NAMES:
                raise DomainError("Unknown tool")
            async with self.lock:
                result = await method(**args)
            await self.events.emit(
                self.state.call_id,
                "tool.completed",
                tool_id=tool_id,
                name=name,
                duration_ms=round((time.monotonic() - started) * 1000),
                result=result,
            )
            return {"ok": True, **result}
        except asyncio.CancelledError:
            await self.events.emit(
                self.state.call_id, "tool.cancelled", "warning", tool_id=tool_id, name=name
            )
            raise
        except Exception as exc:
            await self.events.failure(
                self.state.call_id, "tool.failed", exc, tool_id=tool_id, name=name
            )
            return {
                "ok": False,
                "error": str(exc),
                "retry_instruction": "Explain briefly; clarify invalid data. Never claim success or invent results.",
            }

    async def clinic_catalog(self):
        return {"catalog": self.catalog, "today": str(self.state.today)}

    async def nearest_sites(self, address: str):
        if not self.geocoder:
            raise DomainError("Geocoder unavailable; ask which site the caller can attend")
        origin = await self.geocoder(address)
        if not origin:
            raise DomainError("Address not found; ask for street, number and municipality")
        lon, lat = origin
        ranked = []
        for site in self.catalog.get("locations", []):
            lat2, lon2 = float(site["latitude"]), float(site["longitude"])
            a = (
                math.sin(math.radians(lat2 - lat) / 2) ** 2
                + math.cos(math.radians(lat))
                * math.cos(math.radians(lat2))
                * math.sin(math.radians(lon2 - lon) / 2) ** 2
            )
            ranked.append(
                {
                    "location_id": site["id"],
                    "name": site["name"],
                    "distance_km": round(6371 * 2 * math.asin(min(1, math.sqrt(a))), 3),
                }
            )
        return {
            "sites": sorted(ranked, key=lambda x: x["distance_km"]),
            "instruction": "Search availability in this order; nearest must actually serve the request.",
        }

    async def search_directory(
        self,
        name: str,
        national_id: str | None = None,
        phone: str | None = None,
        date_of_birth: str | None = None,
    ):
        # A lookup starts a new identity selection, including third-party requests.
        self.state.invalidate()
        self.state.patient_id = None
        self.state.offers.clear()
        self.state.appointments.clear()
        query = {
            k: v
            for k, v in dict(
                name=name, national_id=national_id, phone=phone, date_of_birth=date_of_birth
            ).items()
            if v
        }
        result = await self.client.directory(query)
        matches = result.get("matches", [])
        self.state.unmatched = not matches
        exact = any(query.get(k) for k in ("national_id", "phone", "date_of_birth"))
        # Second identifier must have been supplied in this call, not sourced from caller ID.
        heard = re.sub(r"\W", "", fold(" ".join(self.state.transcripts.values())))
        evidence = False
        for field in ("national_id", "phone", "date_of_birth"):
            if query.get(field):
                normalized = re.sub(r"\W", "", fold(query[field]))
                if normalized in heard or (field == "phone" and normalized[-9:] in heard):
                    evidence = True
                if field == "date_of_birth":
                    evidence = evidence or birth_date_heard(
                        query[field], self.state.transcripts.values()
                    )
        if len(matches) == 1 and name.strip() and exact and evidence:
            patient = matches[0]
            self.state.patient_id = patient["patient_id"]
            self.state.verified[patient["patient_id"]] = patient
            self.state.stage = "request"
            await self.events.emit(
                self.state.call_id,
                "identity.verified",
                patient_id=patient["patient_id"],
                fields=list(query),
            )
        # Never give a model another patient's protected identifiers to read aloud.
        safe = [
            {k: v for k, v in m.items() if k not in {"national_id", "phone", "date_of_birth"}}
            for m in matches
        ]
        return {
            "matches": safe,
            "verified_patient_id": self.state.patient_id,
            "instruction": "If not verified ask caller for a second identifier and search again. Do not read protected fields aloud.",
        }

    async def list_appointments(self, when: str = "upcoming"):
        self.state.require_patient()
        if when not in {"upcoming", "past", "all"}:
            raise DomainError("Invalid appointment window")
        result = await self.client.appointments(self.state.patient_id, when)
        for item in result.get("appointments", []):
            starts = datetime.fromisoformat(item["start_time"])
            if (
                when != "past"
                and starts.astimezone(MADRID).date() >= self.state.today
                and (when == "upcoming" or starts >= self.state.connected_at)
            ):
                self.state.appointments[item["appointment_id"]] = item
        return result

    async def search_availability(
        self,
        specialty_id: str | None = None,
        provider_id: str | None = None,
        location_id: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        policy_id: str | None = None,
        time_of_day: str = "any",
        weekday: int | None = None,
        provider_language: str | None = None,
    ):
        patient = self.state.require_patient()
        self.state.invalidate()
        self.state.offers.clear()
        revision = self.state.revision
        policy = policy_id or patient["insurer"]
        if policy not in INSURERS:
            raise DomainError("Unknown policy; ask for a real plan held by the patient")
        if policy != patient["insurer"]:
            heard = fold(" ".join(self.state.transcripts.values())).replace("_", " ")
            if policy.replace("_", " ") not in heard:
                raise DomainError("Caller must state the second policy before it can be searched")
        start = max(
            date.fromisoformat(date_from) if date_from else self.state.today + timedelta(days=1),
            self.state.today + timedelta(days=1),
        )
        end = date.fromisoformat(date_to) if date_to else start + timedelta(days=13)
        calendar = self.catalog.get("calendar", {})
        if calendar.get("starts"):
            start = max(start, date.fromisoformat(calendar["starts"]))
            end = min(end, date.fromisoformat(calendar["ends"]))
        if end < start or (end - start).days > 13:
            raise DomainError(
                "Search window must be within the clinic calendar and at most 14 days inclusive"
            )
        if time_of_day not in {"any", "morning", "afternoon"}:
            raise DomainError("time_of_day must be any, morning or afternoon")
        if weekday is not None and weekday not in range(7):
            raise DomainError("weekday is Monday=0 through Sunday=6")
        query = {
            "date_from": str(start),
            "date_to": str(end),
            "patient_id": self.state.patient_id,
            "insurer": policy,
        }
        for key, value in {
            "specialty_id": specialty(specialty_id),
            "provider_id": provider_id,
            "location_id": location(location_id),
        }.items():
            if value:
                query[key] = value
        data = await self.client.availability(query)
        if revision != self.state.revision:
            raise DomainError("Search superseded by a correction")
        providers = {p["id"]: p for p in self.catalog.get("providers", [])}
        slots = []
        for slot in data.get("slots", []):
            dt = datetime.fromisoformat(slot["start_time"])
            if dt.tzinfo is None:
                continue
            local = dt.astimezone(MADRID)
            if (
                not start <= local.date() <= end
                or local.date() <= self.state.today
                or local.date().isoformat() in calendar.get("closure_days", [])
            ):
                continue
            if (
                time_of_day == "morning"
                and local.hour >= 14
                or time_of_day == "afternoon"
                and local.hour < 14
            ):
                continue
            if weekday is not None and local.weekday() != weekday:
                continue
            if provider_language and provider_language not in providers.get(
                slot["provider_id"], {}
            ).get("languages", []):
                continue
            if slot.get("payable_with") and policy not in slot["payable_with"]:
                continue
            slots.append(slot)
        slots.sort(key=lambda s: datetime.fromisoformat(s["start_time"]))
        # The next query can narrow a date/time; retain only bounded offers in model context.
        offered = []
        for slot in slots[:24]:
            ref = f"offer_{revision}_{len(offered) + 1}"
            self.state.offers[ref] = {
                **slot,
                "patient_id": self.state.patient_id,
                "policy_id": policy,
            }
            offered.append({"offer_ref": ref, **slot})
        self.state.stage = "proposal"
        return {
            "offers": offered,
            "total_matching": len(slots),
            "blocked": data.get("blocked", []),
            "appointment_type": data.get("appointment_type"),
            "policy_id": policy,
            "instruction": "Use offer_ref. If plan blocks, ask whether caller holds a second plan; never assume privado. Search narrower windows for other times.",
        }

    async def prepare_action(
        self,
        action: str,
        offer_ref: str | None = None,
        appointment_id: str | None = None,
        registration: dict | None = None,
    ):
        if action not in {"book", "cancel", "reschedule", "register"}:
            raise DomainError("Unsupported proposed action")
        self.state.invalidate()
        if action == "register":
            if not self.state.unmatched:
                raise DomainError(
                    "Search directory first; registration is only for a caller not found"
                )
            payload = Registration.model_validate(registration or {}).model_dump(mode="json")
        else:
            self.state.require_patient()
            if action in {"book", "reschedule"}:
                offer = self.state.offers.get(offer_ref or "")
                if not offer or offer["patient_id"] != self.state.patient_id:
                    raise DomainError("Unknown/stale offer; search availability again")
                payload = {k: offer[k] for k in ("provider_id", "location_id", "policy_id")}
                payload["slot"] = offer["start_time"]
                if action == "book":
                    payload.update(
                        patient_id=offer["patient_id"],
                        appointment_type_id=offer["appointment_type_id"],
                    )
            else:
                payload = {}
            if action in {"cancel", "reschedule"}:
                appointment = self.state.appointments.get(appointment_id or "")
                if not appointment or appointment["patient_id"] != self.state.patient_id:
                    raise DomainError("List this patient's upcoming appointments first")
                payload["appointment_id"] = appointment_id
        proposal = Proposal(
            action=action,
            payload=payload,
            prepared_turn=self.state.turn,
            revision=self.state.revision,
        )
        self.state.proposal = proposal
        self.state.stage = "confirmation"
        await self.events.emit(
            self.state.call_id, "proposal.prepared", proposal=proposal.model_dump()
        )
        return {
            "proposal_id": proposal.id,
            "action": action,
            "details": payload,
            "instruction": "Read the action and relevant details to the caller, ask explicit confirmation, and WAIT for a new user turn. Do not read DNI/phone from records.",
        }

    async def commit_action(self, proposal_id: str, confirmation_quote: str):
        proposal = self.state.proposal
        if not proposal or proposal.id != proposal_id or proposal.revision != self.state.revision:
            raise DomainError("Proposal expired. Prepare the corrected action and ask again")
        latest = self.state.transcripts.get(self.state.turn, "")
        if self.state.turn <= proposal.prepared_turn or not proposal.spoken:
            raise DomainError(
                "Wait until the proposal has been spoken and a NEW caller confirmation arrives"
            )
        if (
            not confirmation_quote.strip()
            or fold(confirmation_quote) not in fold(latest)
            or not affirmative(latest)
        ):
            raise DomainError(
                "No unambiguous confirmation in the latest user turn. Clarify the correction"
            )
        result = await self._submit(proposal.action, proposal.payload)
        self.state.proposal = None
        self.state.stage = "result"
        return result

    async def report_outcome(self, action: str, reason: str):
        if action not in {"no-action", "escalate"}:
            raise DomainError("Use no-action or escalate")
        reason = Reason(reason).value
        if reason == Reason.EMERGENCY and action != "escalate":
            raise DomainError("Medical emergency must be escalated")
        if action == "no-action" and self.state.actions:
            raise DomainError(
                "This call already contains actions. Do not append a generic no-action"
            )
        return await self._submit(action, {"reason": reason})

    async def revise_request(self):
        self.state.invalidate()
        self.state.offers.clear()
        self.state.stage = "request"
        return {
            "instruction": "Previous proposal invalidated. Gather corrected preferences and search again."
        }

    async def _submit(self, action: str, payload: dict):
        key = hashlib.sha256(json.dumps([action, payload], sort_keys=True).encode()).hexdigest()
        if key in self.results:
            return self.results[key]
        if key in self.unknown:
            raise DomainError(
                "Previous submission result is unknown; do not repeat or claim success. Inspect operation log."
            )
        self.unknown.add(key)
        await self.events.emit(
            self.state.call_id,
            "operation.started",
            operation_id=key,
            action=action,
            payload=payload,
        )

        async def perform():
            try:
                result = await self.client.submit(action, payload)
            except ProsperError as exc:
                if exc.status == 409:
                    result = {
                        "duplicate": True,
                        "instruction": "Identical action was previously accepted for this call",
                    }
                elif exc.status < 500 and exc.status != 429:
                    self.unknown.discard(key)
                    await self.events.failure(
                        self.state.call_id, "operation.rejected", exc, operation_id=key
                    )
                    raise
                else:
                    await self.events.failure(
                        self.state.call_id, "operation.unknown", exc, operation_id=key
                    )
                    raise
            except Exception as exc:
                await self.events.failure(
                    self.state.call_id, "operation.unknown", exc, operation_id=key
                )
                raise
            accepted = {"action": action, "payload": payload, "receipt": result}
            self.results[key] = accepted
            self.unknown.discard(key)
            self.state.actions.append(accepted)
            await self.events.emit(
                self.state.call_id, "operation.accepted", operation_id=key, **accepted
            )
            return accepted

        task = asyncio.create_task(perform())
        self.inflight.add(task)
        task.add_done_callback(self.inflight.discard)
        return await asyncio.shield(task)

    async def drain(self):
        if self.inflight:
            await asyncio.wait_for(
                asyncio.gather(*list(self.inflight), return_exceptions=True), timeout=20
            )


TOOL_NAMES = {
    "clinic_catalog",
    "search_directory",
    "search_availability",
    "list_appointments",
    "prepare_action",
    "commit_action",
    "report_outcome",
    "revise_request",
    "nearest_sites",
}
