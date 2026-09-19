import { expect } from "bun:test";
import { generateScenario, type Kind, type Scenario } from "../../src/simulation/scenario";
import type { ClinicReader } from "../../src/voice/agent";
import type { ObjectValue } from "../../src/data";

export const now = "2026-09-19T14:00:00Z";
export const slot = { provider_id: "PR-live", provider_name: "Dra. Actual", location_id: "centro", specialty_id: "general_practice",
  appointment_type_id: "review", start_time: "2026-09-22T10:15:00+02:00", payable_with: ["mapfre"] };
function database(overrides: { start?: string; end?: string; empty?: boolean; expiredAppointment?: boolean } = {}) {
  const requests: { method: string; path: string }[] = [];
  const clinic: ClinicReader = { async request(request) {
    requests.push(request);
    expect(request.method).toBe("GET");
    const url = new URL(request.path, "https://clinic.test");
    let data: ObjectValue;
    if (url.pathname === "/api/v1/clinic") data = {
      calendar: { starts: "2026-09-07", ends: overrides.end ?? "2026-10-16", max_span_days: 14 },
      providers: [{ id: "PR-live", name: "Dra. Actual", languages: ["en", "es", "ca"] }], locations: [{ id: "centro", name: "Arenal Centro" }],
    };
    else if (url.pathname === "/api/v1/directory") data = { matches: [{ patient_id: "P-live", national_id: url.searchParams.get("national_id"),
      date_of_birth: "1980-01-01", given_name: "Persona", first_surname: "Actual", second_surname: "Prueba", insurer: "mapfre", phone: "600000000", has_visited_before: true }] };
    else if (url.pathname.endsWith("/appointments")) data = { appointments: [{ ...slot, patient_id: "P-live", appointment_id: "A-live",
      start_time: overrides.expiredAppointment ? "2026-09-01T10:00:00+02:00" : "2026-09-28T10:00:00+02:00" }] };
    else if (url.pathname === "/api/v1/availability") {
      expect(url.searchParams.get("patient_id")).toBe("P-live"); expect(url.searchParams.get("insurer")).toBe("mapfre");
      expect(url.searchParams.get("date_from")).toBe("2026-09-20");
      data = { slots: overrides.empty ? [] : [{ ...slot, start_time: overrides.start ?? slot.start_time }] };
    } else throw new Error(`Unexpected GET ${url.pathname}`);
    return { status: 200, elapsed_ms: 1, meaning: "OK", data };
  } };
  return { clinic, requests };
}
export async function scenario(kind: Kind = "book", options: Parameters<typeof database>[0] = {}): Promise<Scenario> {
  return generateScenario(database(options).clinic, { kind, language: "es", seed: "reproducible", now }, new AbortController().signal);
}

