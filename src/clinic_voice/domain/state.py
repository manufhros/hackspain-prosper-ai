import re
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator

MADRID = ZoneInfo("Europe/Madrid")
INSURERS = {
    "sanitas",
    "adeslas",
    "dkv",
    "asisa",
    "mapfre",
    "caser",
    "cigna",
    "axa",
    "nueva_mutua",
    "privado",
}


class Reason(StrEnum):
    AGE = "not_eligible_age"
    REFERRAL = "referral_required"
    NETWORK = "provider_not_in_network"
    SPECIALTY = "specialty_not_covered"
    LOCATION = "location_not_covered"
    INSURER_REFERRAL = "insurer_referral_required"
    ALLOWANCE = "allowance_exhausted"
    LEAVE = "provider_on_leave"
    HOURS = "location_hours"
    TYPE = "type_not_offered"
    HISTORY = "patient_history"
    NO_AVAILABILITY = "no_availability"
    CLOSED = "clinic_closed"
    PATIENT = "patient_not_found"
    PROVIDER = "provider_not_found"
    UNAUTHORISED = "caller_not_authorised"
    OUT_OF_SCOPE = "out_of_scope"
    EMERGENCY = "medical_emergency"


class DomainError(ValueError):
    pass


class Registration(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    given_name: str = Field(min_length=1)
    first_surname: str = Field(min_length=1)
    second_surname: str = Field(min_length=1)
    national_id: str
    date_of_birth: date
    phone: str
    email: str
    insurer: str

    @field_validator("national_id")
    @classmethod
    def valid_id(cls, value):
        value = re.sub(r"[\s-]", "", value.upper())
        if not re.fullmatch(r"(?:\d{8}|[XYZ]\d{7})[A-Z]", value):
            raise ValueError("DNI/NIE format invalid; ask caller to repeat")
        digits = value[:-1]
        if digits[0] in "XYZ":
            digits = str("XYZ".index(digits[0])) + digits[1:]
        if "TRWAGMYFPDXBNJZSQVHLCKE"[int(digits) % 23] != value[-1]:
            raise ValueError("DNI/NIE check letter mismatch; do not invent a correction")
        return value

    @field_validator("insurer")
    @classmethod
    def plan(cls, value):
        if value not in INSURERS:
            raise ValueError("Unknown insurer")
        return value

    @field_validator("phone")
    @classmethod
    def phone_number(cls, value):
        if len(re.sub(r"\D", "", value)) < 9:
            raise ValueError("Incomplete phone")
        return value

    @field_validator("email")
    @classmethod
    def email_address(cls, value):
        value = re.sub(r"\s", "", value).lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Incomplete email")
        return value


class Proposal(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex[:12])
    action: str
    payload: dict[str, Any]
    prepared_turn: int
    revision: int
    spoken: bool = False


class CallState(BaseModel):
    call_id: str
    connected_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    today: date
    from_number: str = ""
    stage: str = "reception"
    language: str = "es"
    turn: int = 0
    transcripts: dict[int, str] = Field(default_factory=dict)
    revision: int = 0
    verified: dict[str, dict] = Field(default_factory=dict)
    patient_id: str | None = None
    offers: dict[str, dict] = Field(default_factory=dict)
    appointments: dict[str, dict] = Field(default_factory=dict)
    proposal: Proposal | None = None
    actions: list[dict] = Field(default_factory=list)
    unmatched: bool = False
    speaking: bool = False
    interrupted: bool = False

    def user_turn(self, text: str):
        self.turn += 1
        self.transcripts[self.turn] = text

    def invalidate(self):
        self.revision += 1
        self.proposal = None

    def require_patient(self):
        if not self.patient_id or self.patient_id not in self.verified:
            raise DomainError(
                "Verify patient with name and a caller-supplied second identifier first"
            )
        return self.verified[self.patient_id]


def clinic_today(now: datetime, mode: str) -> date:
    local = now.astimezone(MADRID)
    return local.date() - timedelta(days=int(mode == "lucia_9am" and local.hour < 9))
