import type { LoggedCall } from "./types";

export function filterSite(calls: LoggedCall[], site?: string | null): LoggedCall[] {
  if (site === undefined) return calls;
  if (site === null || site === "none") return calls.filter((call) => !call.site);
  return calls.filter((call) => call.site === site);
}

export function lineMinutes(calls: LoggedCall[]): number {
  return calls.reduce((sum, call) => sum + (call.minutes || 0), 0);
}

export function byOutcome(calls: LoggedCall[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const call of calls) map.set(call.outcome, (map.get(call.outcome) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

const INTENT_LABEL: Record<string, string> = {
  appointment_action: "Gestión de citas",
  general_faq: "Información general",
  medical_emergency: "Urgencia médica",
};

/** Display the agent's recorded classification, without guessing a specialty from text. */
export function byConsultation(calls: LoggedCall[]) {
  const map = new Map<string, number>();
  for (const call of calls) {
    const name = call.intent ? INTENT_LABEL[call.intent] ?? call.intent.replaceAll("_", " ") : "Sin clasificar";
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
