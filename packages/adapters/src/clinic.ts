import { DomainError } from "../../contracts/src/index.js";
import { z } from "zod";
import type {
  Action,
  ActionSink,
  Appointment,
  Availability,
  BookingRequest,
  ClinicDataSource,
  Patient,
  PatientQuery,
  Receipt,
  Slot,
} from "../../contracts/src/index.js";
const patientSchema = z.object({
  patient_id: z.string(),
  given_name: z.string(),
  first_surname: z.string(),
  second_surname: z.string(),
  national_id: z.string(),
  date_of_birth: z.string(),
  phone: z.string(),
  insurer: z.string(),
  note: z.string(),
  has_visited_before: z.boolean(),
  matched_fields: z.array(z.string()).optional(),
});
const slotSchema = z.object({
  provider_id: z.string(),
  provider_name: z.string(),
  specialty_id: z.string(),
  location_id: z.string(),
  appointment_type_id: z.string(),
  start_time: z.string().datetime({ offset: true }),
  duration_minutes: z.number().int().positive(),
  payable_with: z.array(z.string()),
});
const availabilitySchema = z.object({
  slots: z.array(slotSchema),
  blocked: z.array(
    z.object({ provider_id: z.string(), restriction: z.string() }),
  ),
});
const appointmentSchema = z.object({
  appointment_id: z.string(),
  patient_id: z.string(),
  provider_id: z.string(),
  location_id: z.string(),
  appointment_type_id: z.string(),
  start_time: z.string().datetime({ offset: true }),
});
export class ProsperHttp {
  constructor(
    private base: string,
    private key: string,
    private fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(base);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw new Error("HTTPS API base required");
  }
  async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    return this.fetcher(new URL(path, this.base), {
      ...init,
      redirect: "error",
      headers: { "X-Api-Key": this.key, "Content-Type": "application/json" },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
        : AbortSignal.timeout(5000),
    });
  }
  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const r = await this.request(path, {}, signal);
    if (!r.ok) throw new DomainError(r.status === 404 ? "clinic_resource_not_found" : r.status === 422 ? "clinic_invalid_query" : r.status === 429 ? "clinic_rate_limited" : "clinic_unavailable");
    return r.json() as Promise<T>;
  }
}
export class ProsperClinic implements ClinicDataSource {
  readonly id = "prosper";
  private cached?: Promise<unknown>;
  constructor(private http: ProsperHttp) {}
  catalog() {
    if (!this.cached)
      this.cached = this.http.get("/api/v1/clinic").catch((e) => {
        this.cached = undefined;
        throw e;
      });
    return this.cached;
  }
  async patients(query: PatientQuery, signal?: AbortSignal) {
    return z
      .object({ matches: z.array(patientSchema) })
      .parse(await this.http.get(`/api/v1/directory?${params(query)}`, signal))
      .matches;
  }
  async availability(
    request: BookingRequest & { patient_id: string },
    signal?: AbortSignal,
  ) {
    const { period: _, ...query } = request;
    return availabilitySchema.parse(
      await this.http.get(`/api/v1/availability?${params(query)}`, signal),
    );
  }
  async appointments(patientId: string, signal?: AbortSignal) {
    return z
      .object({ appointments: z.array(appointmentSchema) })
      .parse(
        await this.http.get(
          `/api/v1/patients/${encodeURIComponent(patientId)}/appointments?when=upcoming`,
          signal,
        ),
      ).appointments;
  }
}
function params(input: object) {
  const result = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined)
      for (const value of Array.isArray(v) ? v : [v])
        result.append(k, String(value));
  }
  return result.toString();
}
export class ProsperSink implements ActionSink {
  readonly id = "prosper";
  constructor(private http: ProsperHttp) {}
  async deliver(
    callId: string,
    action: Action,
    signal?: AbortSignal,
  ): Promise<Receipt> {
    const { action: kind, ...rest } = action;
    const fields = action.action === "REGISTER" ? action.new_patient : rest;
    const route = kind.toLowerCase().replace("_", "-");
    const r = await this.http.request(
      `/api/v1/submit/${route}`,
      { method: "POST", body: JSON.stringify({ call_id: callId, ...fields }) },
      signal,
    );
    if (r.status >= 500 || r.status === 429)
      throw new Error("Temporary delivery failure");
    return {
      status:
        r.status === 200
          ? "accepted"
          : r.status === 409
            ? "duplicate"
            : r.status === 410
              ? "expired"
              : "rejected",
      httpStatus: r.status,
    };
  }
}
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}|[\s-]/gu, "");
export class FixtureClinic implements ClinicDataSource {
  readonly id = "fixture";
  readonly patient: Patient = {
    patient_id: "DEMO-P1",
    given_name: "Ana",
    first_surname: "García",
    second_surname: "López",
    national_id: "12345678Z",
    date_of_birth: "1988-03-14",
    phone: "612345678",
    insurer: "sanitas",
    note: "Datos sintéticos de demostración.",
    has_visited_before: true,
  };
  async catalog() {
    return {
      demo: true,
      specialties: [{ id: "general_practice", name: "Medicina general" }],
      locations: [
        { id: "centro", name: "Centro" },
        { id: "norte", name: "Norte" },
      ],
      providers: [{ id: "DEMO-DR1", name: "Dra. Elena Ortiz" }],
    };
  }
  async patients(query: PatientQuery) {
    const entries = Object.entries(query).filter(([, v]) => v);
    if (!entries.length) return [];
    return entries.every(([k, v]) =>
      k === "name"
        ? fold(
            `${this.patient.given_name} ${this.patient.first_surname}`,
          ).includes(fold(v!))
        : k === "phone"
          ? String(v).replace(/\D/g, "").slice(-9) === this.patient.phone
          : fold(String(this.patient[k as keyof Patient])) === fold(v!),
    )
      ? [{ ...this.patient }]
      : [];
  }
  async availability(
    r: BookingRequest & { patient_id: string },
  ): Promise<Availability> {
    const date = r.date_from;
    const winter =
      Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Madrid",
          hour: "numeric",
          hourCycle: "h23",
        }).format(new Date(date + "T12:00:00Z")),
      ) === 13;
    const offset = winter ? "+01:00" : "+02:00";
    const slots: Slot[] = [9, 11, 16].map((h) => ({
      provider_id: "DEMO-DR1",
      provider_name: "Dra. Elena Ortiz",
      specialty_id: "general_practice",
      location_id: r.location_id ?? "centro",
      appointment_type_id: "review",
      start_time: `${date}T${String(h).padStart(2, "0")}:00:00${offset}`,
      duration_minutes: 15,
      payable_with: ["sanitas"],
    }));
    return { slots, blocked: [] };
  }
  async appointments(patientId: string) {
    return [
      {
        appointment_id: "DEMO-A1",
        patient_id: patientId,
        provider_id: "DEMO-DR1",
        location_id: "centro",
        appointment_type_id: "review",
        start_time: "2026-10-01T10:00:00+02:00",
      },
    ];
  }
}
export class MemorySink implements ActionSink {
  readonly id = "simulation";
  readonly records = new Map<string, Action[]>();
  async deliver(callId: string, action: Action): Promise<Receipt> {
    const actions = this.records.get(callId) ?? [];
    if (actions.some((a) => JSON.stringify(a) === JSON.stringify(action)))
      return { status: "duplicate", httpStatus: 409 };
    actions.push(structuredClone(action));
    this.records.set(callId, actions);
    return { status: "accepted", httpStatus: 200 };
  }
}
