import "server-only";

import type { ClinicCatalog, SubmitResponse } from "../../src/platform/types";

import { loadLabSecrets } from "./root-env";

function queryString(params: object) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export async function prosper() {
  const { platformKey, platformBase } = await loadLabSecrets();
  const base = `${platformBase}/api/v1`;
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!platformKey) throw new Error("Falta PLATFORM_API_KEY");
    const response = await fetch(`${base}${path}`, {
      cache: "no-store",
      ...init,
      headers: {
        "X-Api-Key": platformKey,
        Accept: "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Prosper ${response.status} ${path}`);
    }
    return payload as T;
  }
  return {
    clinic: () => request<ClinicCatalog>("/clinic"),
    directory: (query: { name?: string; national_id?: string; phone?: string }) =>
      request<{ matches: Array<{
        patient_id: string;
        given_name: string;
        first_surname: string;
        second_surname: string;
        national_id: string;
        insurer?: string;
      }> }>(`/directory${queryString(query)}`),
    appointments: (patientId: string) =>
      request<{ appointments: Array<{
        appointment_id: string;
        location_id: string;
        start_time: string;
      }> }>(`/patients/${encodeURIComponent(patientId)}/appointments${queryString({ when: "upcoming" })}`),
    availability: (query: {
      date_from: string;
      date_to: string;
      location_id?: string;
      specialty_id?: string;
      patient_id?: string;
    }) =>
      request<{ slots: Array<{
        provider_id: string;
        location_id: string;
        appointment_type_id: string;
        start_time: string;
      }> }>(`/availability${queryString(query)}`),
    submitBook: (body: Record<string, unknown>) =>
      request<SubmitResponse>("/submit/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    submitCancel: (body: Record<string, unknown>) =>
      request<SubmitResponse>("/submit/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    submitReschedule: (body: Record<string, unknown>) =>
      request<SubmitResponse>("/submit/reschedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    submitRegister: (body: Record<string, unknown>) =>
      request<SubmitResponse>("/submit/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    submitNoAction: (body: Record<string, unknown>) =>
      request<SubmitResponse>("/submit/no-action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    submitEscalate: (body: Record<string, unknown>) =>
      request<SubmitResponse>("/submit/escalate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

export function addYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function clinicTodayYmd(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  return Number(get("hour")) < 9 ? addYmd(today, -1) : today;
}
