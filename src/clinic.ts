import type {
  Appointment,
  AvailabilitySlot,
  PatientMatch,
} from "./state/call-state";

const baseUrl = () =>
  (process.env.PLATFORM_API_BASE_URL ?? "https://hackspain.getprosperapp.com").replace(
    /\/$/,
    "",
  );

function clinicHeaders(): HeadersInit {
  const key = process.env.PLATFORM_API_KEY;
  if (!key) throw new Error("PLATFORM_API_KEY is missing");
  return { "X-Api-Key": key };
}

async function clinicGet(path: string, query: Record<string, string | undefined> = {}) {
  const url = new URL(baseUrl() + path);
  for (const [k, v] of Object.entries(query)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: clinicHeaders() });
  const body = await res.json().catch(() => ({ raw: res.statusText }));
  if (!res.ok) {
    throw new Error(`clinic GET ${path} ${res.status}: ${JSON.stringify(body)}`);
  }
  return body as Record<string, unknown>;
}

export async function searchDirectory(input: {
  name?: string;
  national_id?: string;
  phone?: string;
  date_of_birth?: string;
}) {
  return clinicGet("/api/v1/directory", input) as Promise<{ matches: PatientMatch[] }>;
}

export async function searchAvailability(input: {
  date_from: string;
  date_to: string;
  patient_id?: string;
  specialty_id?: string;
  provider_id?: string;
  location_id?: string;
  insurer?: string;
}) {
  const data = await clinicGet("/api/v1/availability", input);
  const slots = Array.isArray(data.slots) ? data.slots : [];
  return {
    ...data,
    slots: slots as AvailabilitySlot[],
    blocked: (Array.isArray(data.blocked) ? data.blocked : []) as Array<{
      provider_id: string;
      restriction: string;
    }>,
    slot_count: slots.length,
  };
}

export async function listAppointments(patient_id: string, when = "upcoming") {
  return clinicGet(`/api/v1/patients/${encodeURIComponent(patient_id)}/appointments`, {
    when,
  }) as Promise<{ appointments: Appointment[] }>;
}

export type ClinicProvider = {
  id: string;
  name: string;
  specialty_id: string;
  specialty_name: string;
  languages: string[];
  location_names: string[];
  schedules: Array<{ location_id: string; location_name: string }>;
  leave: { start: string; end: string; reason: string } | null;
};

export async function listProviders() {
  return clinicGet("/api/v1/providers") as Promise<{ providers: ClinicProvider[] }>;
}

export async function clinicOverview() {
  return clinicGet("/api/v1/clinic");
}

export async function submit(action: string, payload: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}/api/v1/submit/${action}`, {
    method: "POST",
    headers: { ...clinicHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({ raw: res.statusText }));
  return { status_code: res.status, body };
}
