import { loadPublicCases } from "@/lib/cases/load";
import { normalizeNationalId, normalizePhone } from "@/lib/cases/score";
import { clinicTodayYmd, diffYmd, shiftIsoDays } from "@/lib/time";
import { CLINIC_LOCATIONS, CLINIC_SPECIALTIES } from "./options";
import type {
  Appointment,
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilitySlot,
  BookRequest,
  CancelRequest,
  ClinicCatalog,
  ClinicSource,
  ClinicSourceInfo,
  DirectoryQuery,
  DirectoryResponse,
  PatientMatch,
  ReasonRequest,
  RegisterRequest,
  RescheduleRequest,
  SubmittedAction,
  SubmitResponse,
} from "./types";

type IndexedPatient = PatientMatch & { expectedSlots: AvailabilitySlot[]; appointments: Appointment[] };
type CaseItem = ReturnType<typeof loadPublicCases>[number];
type PersonaData = CaseItem["persona"]["data"];

function nationalIdOf(data: PersonaData) {
  return data.patient_national_id || data.national_id;
}

function phoneOf(data: PersonaData, fallback?: string) {
  return data.patient_phone || data.phone || fallback;
}

function buildIndex() {
  const patients = new Map<string, IndexedPatient>();
  const byNationalId = new Map<string, IndexedPatient>();
  const byPhone = new Map<string, IndexedPatient>();

  const remember = (patient: IndexedPatient) => {
    patients.set(patient.patient_id, patient);
    if (patient.national_id) {
      const key = normalizeNationalId(patient.national_id);
      const prev = byNationalId.get(key);
      if (!prev || prev.patient_id.startsWith("persona:") || prev.patient_id.startsWith("from-case:")) {
        byNationalId.set(key, patient);
      }
    }
    if (patient.phone) {
      const key = normalizePhone(patient.phone);
      const prev = byPhone.get(key);
      if (!prev || prev.patient_id.startsWith("persona:") || prev.patient_id.startsWith("from-case:")) {
        byPhone.set(key, patient);
      }
    }
  };

  const upsert = (
    preferredId: string | undefined,
    data: PersonaData,
    item: CaseItem,
    identity: { national_id?: string; phone?: string; given_name?: string; first_surname?: string; second_surname?: string; date_of_birth?: string; insurer?: string },
  ) => {
    const nid = identity.national_id ? normalizeNationalId(identity.national_id) : "";
    const existing =
      (preferredId ? patients.get(preferredId) : undefined) ??
      (nid ? byNationalId.get(nid) : undefined);
    const patientId =
      existing?.patient_id ??
      (preferredId && !preferredId.startsWith("persona:") ? preferredId : undefined) ??
      preferredId ??
      (nid ? `nid:${nid}` : `persona:${item.id}`);
    const patient = existing ?? {
      patient_id: patientId,
      given_name: identity.given_name ?? data.given_name ?? item.persona.name.split(" ")[0] ?? item.persona.name,
      first_surname: identity.first_surname ?? data.first_surname ?? "",
      second_surname: identity.second_surname ?? data.second_surname ?? "",
      national_id: identity.national_id ?? data.national_id ?? "",
      date_of_birth: identity.date_of_birth ?? data.date_of_birth ?? "",
      phone: identity.phone ?? data.phone ?? item.persona.phone ?? "",
      insurer: identity.insurer ?? data.insurer,
      has_visited_before: true,
      note: item.summary,
      expectedSlots: [],
      appointments: [],
    };
    remember(patient);
    if (preferredId && preferredId !== patient.patient_id) {
      patients.set(preferredId, patient);
    }
    return patient;
  };

  for (const item of loadPublicCases()) {
    const data = item.persona.data;
    const shift = diffYmd(item.reference_time.slice(0, 10), clinicTodayYmd());
    const actions = item.expected.acceptable.flatMap((option) => option.actions);
    const registerOnly = actions.length > 0 && actions.every((action) => action.action === "REGISTER");
    const seedId = actions.find((action) => typeof action.patient_id === "string")?.patient_id;

    if (!registerOnly) {
      const patientIdentity = {
        national_id: nationalIdOf(data),
        phone: phoneOf(data, item.persona.phone),
        given_name: data.patient_given_name ?? data.given_name,
        first_surname: data.patient_first_surname ?? data.first_surname,
        second_surname: data.patient_second_surname ?? data.second_surname,
        date_of_birth: data.patient_date_of_birth ?? data.date_of_birth,
        insurer: data.patient_insurer ?? data.insurer,
      };
      if (typeof seedId === "string" || patientIdentity.national_id) {
        upsert(typeof seedId === "string" ? seedId : undefined, data, item, patientIdentity);
      }
    }

    for (const action of actions) {
      if (action.action === "BOOK") {
        upsert(String(action.patient_id), data, item, {
          national_id: nationalIdOf(data),
          phone: phoneOf(data, item.persona.phone),
          given_name: data.patient_given_name ?? data.given_name,
          first_surname: data.patient_first_surname ?? data.first_surname,
          second_surname: data.patient_second_surname ?? data.second_surname,
          date_of_birth: data.patient_date_of_birth ?? data.date_of_birth,
          insurer: data.patient_insurer ?? data.insurer,
        }).expectedSlots.push({
          provider_id: String(action.provider_id),
          location_id: String(action.location_id),
          appointment_type_id: String(action.appointment_type_id),
          start_time: shiftIsoDays(String(action.slot), shift),
        });
      }
      if (action.action === "CANCEL" || action.action === "RESCHEDULE") {
        const patient = upsert(
          typeof action.patient_id === "string" ? action.patient_id : undefined,
          data,
          item,
          {
            national_id: nationalIdOf(data) || data.national_id,
            phone: phoneOf(data, item.persona.phone),
            given_name: data.patient_given_name ?? data.given_name,
            first_surname: data.patient_first_surname ?? data.first_surname,
            second_surname: data.patient_second_surname ?? data.second_surname,
            date_of_birth: data.patient_date_of_birth ?? data.date_of_birth,
            insurer: data.patient_insurer ?? data.insurer,
          },
        );
        patient.appointments.push({
          appointment_id: String(action.appointment_id),
          patient_id: patient.patient_id,
          provider_id: String(action.provider_id ?? "PR00"),
          location_id: String(action.location_id ?? "centro"),
          appointment_type_id: "review",
          start_time:
            typeof action.slot === "string"
              ? shiftIsoDays(action.slot, shift)
              : "2026-09-22T10:00:00+02:00",
        });
        if (action.action === "RESCHEDULE" && typeof action.slot === "string") {
          patient.expectedSlots.push({
            provider_id: String(action.provider_id),
            location_id: String(action.location_id),
            appointment_type_id: "review",
            start_time: shiftIsoDays(String(action.slot), shift),
          });
        }
      }
    }
  }

  return { patients, byNationalId, byPhone };
}

export class FixtureClinicSource implements ClinicSource {
  readonly info: ClinicSourceInfo = {
    id: "fixture",
    name: "Public-case fixture",
    kind: "fixture",
  };

  private readonly index = buildIndex();

  async health() {
    return { ok: true, detail: `${this.index.patients.size} fixture patients` };
  }

  async clinic(): Promise<ClinicCatalog> {
    return {
      clinic_name: "Fixture clinic (from public cases)",
      patient_count: this.index.patients.size,
      providers: [],
      specialties: CLINIC_SPECIALTIES.map((item) => ({ id: item.id, name: item.label })),
      appointment_types: [],
      locations: CLINIC_LOCATIONS.map((item) => ({ id: item.id, name: item.label })),
      plans: [],
    };
  }

  async directory(query: DirectoryQuery): Promise<DirectoryResponse> {
    const matches: PatientMatch[] = [];
    if (query.national_id) {
      const hit = this.index.byNationalId.get(normalizeNationalId(query.national_id));
      if (hit) matches.push(hit);
    } else if (query.phone) {
      const hit = this.index.byPhone.get(normalizePhone(query.phone));
      if (hit) matches.push(hit);
    } else if (query.name) {
      const needle = query.name.toLowerCase();
      const seen = new Set<string>();
      for (const patient of this.index.patients.values()) {
        if (seen.has(patient.patient_id)) continue;
        seen.add(patient.patient_id);
        const full = `${patient.given_name} ${patient.first_surname} ${patient.second_surname}`.toLowerCase();
        if (full.includes(needle)) matches.push(patient);
      }
    }
    return { matches };
  }

  async availability(query: AvailabilityQuery): Promise<AvailabilityResponse> {
    const pool = query.patient_id
      ? (this.index.patients.get(query.patient_id)?.expectedSlots ?? [])
      : [...this.index.patients.values()].flatMap((patient) => patient.expectedSlots);
    const slots = pool.filter((slot) => {
      const day = slot.start_time.slice(0, 10);
      if (day < query.date_from || day > query.date_to) return false;
      if (query.provider_id && slot.provider_id !== query.provider_id) return false;
      if (query.location_id && slot.location_id !== query.location_id) return false;
      return true;
    });
    return {
      slots,
      appointment_type: slots[0]
        ? { id: slots[0].appointment_type_id }
        : { id: "review" },
      blocked: [],
    };
  }

  async appointments(patientId: string) {
    return { appointments: this.index.patients.get(patientId)?.appointments ?? [] };
  }

  private records = new Map<string, SubmittedAction[]>();

  private record(callId: string, action: SubmittedAction): SubmitResponse {
    const id = callId || "desk";
    const actions = this.records.get(id) ?? [];
    actions.push(action);
    this.records.set(id, actions);
    return {
      call_id: id,
      received_at: new Date().toISOString(),
      record: { actions },
    };
  }

  private requirePatient(patientId: string) {
    const patient = this.index.patients.get(patientId);
    if (!patient) throw new Error(`Unknown patient ${patientId}`);
    return patient;
  }

  async submitBook(body: BookRequest) {
    const patient = this.requirePatient(body.patient_id);
    patient.appointments.push({
      appointment_id: `A-desk-${Date.now()}`,
      patient_id: body.patient_id,
      provider_id: body.provider_id,
      location_id: body.location_id,
      appointment_type_id: body.appointment_type_id,
      start_time: body.slot,
    });
    return this.record(body.call_id, {
      action: "BOOK",
      patient_id: body.patient_id,
      provider_id: body.provider_id,
      location_id: body.location_id,
      appointment_type_id: body.appointment_type_id,
      slot: body.slot,
      policy_id: body.policy_id,
    });
  }

  async submitRegister(body: RegisterRequest) {
    const patientId = `P-desk-${normalizeNationalId(body.national_id)}`;
    const patient: IndexedPatient = {
      patient_id: patientId,
      given_name: body.given_name,
      first_surname: body.first_surname,
      second_surname: body.second_surname,
      national_id: body.national_id,
      date_of_birth: body.date_of_birth,
      phone: body.phone,
      insurer: body.insurer,
      has_visited_before: false,
      expectedSlots: [],
      appointments: [],
    };
    this.index.patients.set(patientId, patient);
    this.index.byNationalId.set(normalizeNationalId(body.national_id), patient);
    if (body.phone) this.index.byPhone.set(normalizePhone(body.phone), patient);
    return this.record(body.call_id, {
      action: "REGISTER",
      new_patient: {
        given_name: body.given_name,
        first_surname: body.first_surname,
        second_surname: body.second_surname,
        national_id: body.national_id,
        date_of_birth: body.date_of_birth,
        phone: body.phone,
        email: body.email,
        insurer: body.insurer,
      },
    });
  }

  async submitReschedule(body: RescheduleRequest) {
    for (const patient of this.index.patients.values()) {
      const found = patient.appointments.find(
        (row) => row.appointment_id === body.appointment_id,
      );
      if (!found) continue;
      found.provider_id = body.provider_id;
      found.location_id = body.location_id;
      found.start_time = body.slot;
      return this.record(body.call_id, {
        action: "RESCHEDULE",
        appointment_id: body.appointment_id,
        provider_id: body.provider_id,
        location_id: body.location_id,
        slot: body.slot,
        policy_id: body.policy_id,
      });
    }
    throw new Error(`Unknown appointment ${body.appointment_id}`);
  }

  async submitCancel(body: CancelRequest) {
    for (const patient of this.index.patients.values()) {
      const index = patient.appointments.findIndex(
        (row) => row.appointment_id === body.appointment_id,
      );
      if (index < 0) continue;
      patient.appointments.splice(index, 1);
      return this.record(body.call_id, {
        action: "CANCEL",
        appointment_id: body.appointment_id,
      });
    }
    throw new Error(`Unknown appointment ${body.appointment_id}`);
  }

  async submitNoAction(body: ReasonRequest) {
    return this.record(body.call_id, { action: "NO_ACTION", reason: body.reason });
  }

  async submitEscalate(body: ReasonRequest) {
    return this.record(body.call_id, { action: "ESCALATE", reason: body.reason });
  }
}

let fixture: FixtureClinicSource | undefined;

export function getFixtureSource() {
  fixture ??= new FixtureClinicSource();
  return fixture;
}
