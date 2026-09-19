import { cases, type Action, type ObjectValue, type PublicCase } from "../data";
import { madridDay, nationalId, isObject, validateOutcome } from "../validation";
import type { ClinicReader } from "../voice/agent";
import type { Message } from "../voice/runtime";

export type Kind = "book" | "cancel" | "reschedule";
export type Language = "en" | "es" | "ca";
export interface Scenario {
  seed: string;
  kind: Kind;
  case: PublicCase;
  source: { fetched_at: string; patient: ObjectValue; appointment?: ObjectValue; slot?: ObjectValue };
}
export function random(seed: string) {
  let n = 2166136261;
  for (const ch of seed) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle<T>(items: T[], next: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; }
  return copy;
}
const text = (row: ObjectValue, key: string): string => {
  if (typeof row[key] !== "string" || !row[key]) throw new Error(`Clinic response missing ${key}`);
  return row[key] as string;
};
const rows = (value: unknown): ObjectValue[] => Array.isArray(value) ? value.filter(isObject) : [];
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
function appointmentLabel(appointment: ObjectValue, providers: ObjectValue[], locations: ObjectValue[]) {
  const provider = providers.find(p => p.id === appointment.provider_id);
  const location = locations.find(p => p.id === appointment.location_id);
  if (!provider || !location) throw new Error("Appointment references a missing provider or location");
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", dateStyle: "full", timeStyle: "short" })
    .format(new Date(text(appointment, "start_time")));
  return `${date} (Madrid local time), with ${text(provider, "name")} at ${text(location, "name")}`;
}

export async function generateScenario(clinic: ClinicReader, options: {
  seed: string; language?: Language; kind?: Kind; now?: string;
}, signal: AbortSignal): Promise<Scenario> {
  const next = random(options.seed), now = options.now ?? new Date().toISOString();
  const language = options.language ?? (["en", "es", "ca"] as const)[Math.floor(next() * 3)]!;
  const kind = options.kind ?? (["book", "cancel", "reschedule"] as const)[Math.floor(next() * 3)]!;
  async function get(path: string): Promise<ObjectValue> {
    const reply = await clinic.request({ method: "GET", path }, signal);
    if (reply.status !== 200 || !isObject(reply.data)) throw new Error(`Clinic GET ${path.split("?")[0]}: HTTP ${reply.status}`);
    return reply.data;
  }
  const catalog = await get("/api/v1/clinic");
  const providers = rows(catalog.providers), locations = rows(catalog.locations);
  const calendar = isObject(catalog.calendar) ? catalog.calendar : {};
  const tomorrow = addDays(madridDay(now), 1);
  const from = [tomorrow, text(calendar, "starts")].sort().at(-1)!;
  const end = text(calendar, "ends");
  if (kind !== "cancel" && from > end) throw new Error(`Prosper's booking calendar ended on ${end}; no future scenario can be generated.`);
  // Public personas supply lookup identities only. Never reuse their archived expected answers.
  // Appointment-bearing personas improve sampling; every appointment is fetched again live.
  const identities = [...new Set(cases.filter(c => kind === "book" || c.persona.data.appointment_1)
    .map(c => c.persona.data.national_id).filter((id): id is string => typeof id === "string"))];
  for (const identity of shuffle(identities, next).slice(0, 30)) {
    const directory = await get(`/api/v1/directory?national_id=${encodeURIComponent(identity)}`);
    const matches = rows(directory.matches).filter(p => typeof p.national_id === "string" && nationalId(p.national_id) === nationalId(identity));
    if (matches.length !== 1) continue;
    const patient = matches[0]!;
    // This generator roleplays an adult calling about their own care.
    const birth = text(patient, "date_of_birth");
    if (birth > `${Number(madridDay(now).slice(0, 4)) - 18}${madridDay(now).slice(4)}`) continue;
    const patientId = text(patient, "patient_id"), insurer = text(patient, "insurer");
    let appointment: ObjectValue | undefined;
    if (kind !== "book") {
      const existing = await get(`/api/v1/patients/${encodeURIComponent(patientId)}/appointments?when=upcoming`);
      appointment = shuffle(rows(existing.appointments).filter(a => a.patient_id === patientId
        && typeof a.start_time === "string" && Date.parse(a.start_time) > Date.parse(now)), next)[0];
      if (!appointment) continue;
    }
    let slot: ObjectValue | undefined;
    if (kind !== "cancel") {
      const eligibleProviders = providers.filter(p => Array.isArray(p.languages) && p.languages.includes(language)
        && (kind !== "reschedule" || p.id === appointment!.provider_id));
      for (const provider of shuffle(eligibleProviders, next).slice(0, 6)) {
        const span = Math.min(14, typeof calendar.max_span_days === "number" ? calendar.max_span_days : 14);
        const to = [addDays(from, span - 1), end].sort()[0]!;
        const query = new URLSearchParams({ date_from: from, date_to: to, patient_id: patientId,
          provider_id: text(provider, "id"), insurer });
        const result = await get(`/api/v1/availability?${query}`);
        slot = shuffle(rows(result.slots).filter(s => Array.isArray(s.payable_with) && s.payable_with.includes(insurer)
          && typeof s.start_time === "string" && madridDay(s.start_time) >= from && madridDay(s.start_time) <= to
          && (kind !== "reschedule" || (s.location_id === appointment!.location_id && s.start_time !== appointment!.start_time))), next)[0];
        if (slot) break;
      }
      if (!slot) continue;
    }
    let action: Action, objective: string;
    if (kind === "cancel") {
      action = { action: "CANCEL", appointment_id: text(appointment!, "appointment_id") };
      objective = `Cancel only your existing appointment: ${appointmentLabel(appointment!, providers, locations)}.`;
    } else {
      const target = appointmentLabel(slot!, providers, locations);
      const common = { provider_id: text(slot!, "provider_id"), location_id: text(slot!, "location_id"),
        slot: text(slot!, "start_time"), policy_id: insurer };
      if (kind === "book") {
        action = { action: "BOOK", patient_id: patientId, appointment_type_id: text(slot!, "appointment_type_id"), ...common };
        objective = `Book an appointment specifically for ${target}, billed to your ${insurer} plan.`;
      } else {
        action = { action: "RESCHEDULE", appointment_id: text(appointment!, "appointment_id"), ...common };
        objective = `Move only your existing appointment (${appointmentLabel(appointment!, providers, locations)}) to ${target}, billed to your ${insurer} plan.`;
      }
      objective += " This is your preferred date, time, clinician and site; you do not know whether it is available. Do not agree to a different slot, provider, site or insurer.";
    }
    const facts = Object.fromEntries(["given_name", "first_surname", "second_surname", "national_id", "date_of_birth", "phone", "insurer", "has_visited_before"]
      .filter(k => patient[k] !== undefined).map(k => [k, patient[k]]));
    const name = [patient.given_name, patient.first_surname, patient.second_surname].filter(Boolean).join(" ");
    const style = shuffle(["Be concise and cooperative.", "Ask the receptionist to repeat the final appointment details once.",
      "Start with just your request; wait to be asked for identifying details."], next)[0]!;
    const item: PublicCase = { id: `sim-${options.seed}`, problem_id: "generated_live", reference_time: now, language,
      summary: objective, persona: { name, description: "Existing adult patient, calling about their own care", data: facts, objectives: [objective] },
      caller_prompt: `Speak only ${language === "en" ? "English" : language === "es" ? "Spanish" : "Catalan"}. ${style} Answer identity checks with the supplied facts. Read identifiers slowly, digit by digit when asked. Confirm explicitly when the proposed action matches your request. If told to wait, wait silently. Never invent details or extra requests.`,
      audio: { background: "quiet", signal_to_noise_db: null }, protected: [], expected: { acceptable: [{ actions: [action] }] } };
    const errors = validateOutcome(item.expected.acceptable[0]);
    if (errors.length) throw new Error(`Generated oracle invalid: ${errors.join("; ")}`);
    return { seed: options.seed, kind, case: item, source: { fetched_at: now, patient, appointment, slot } };
  }
  throw new Error(`No eligible ${kind} scenario found in the live data. Try another seed, language or --kind book.`);
}

export function simulatedCallerMessages(item: PublicCase): Message[] {
  // Explicit projection: no source records, IDs, expected outcome or receptionist tool state.
  return [{ role: "system", content: ["You are the caller in a telephone conversation, never the receptionist.",
    "Reply as JSON: speech is one short natural spoken response (maximum 450 characters); wait is true only if the receptionist asks you to hold while checking. When waiting, speech must be empty. Do not narrate or use tools. After completion say goodbye and let the receptionist end the call.",
    item.caller_prompt, `Your objective: ${item.persona.objectives.join(" ")}`, `Your personal facts: ${JSON.stringify(item.persona.data)}`].join("\n") }];
}
