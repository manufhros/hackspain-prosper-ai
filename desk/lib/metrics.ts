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

export function consultationType(motive: string): string {
  const value = motive.toLowerCase();
  if (/trauma|ortho|hombro|espalda|rodilla|caída|shoulder|knee|back/.test(value)) return "Traumatología";
  if (/gine|gyn|contrace|embarazo|pregnan/.test(value)) return "Ginecología";
  if (/derma|piel|skin|lunar|mole|rash/.test(value)) return "Dermatología";
  if (/pedi|niñ|child|kid|hij/.test(value)) return "Pediatría";
  if (/cardio|pecho|chest|corazón|heart/.test(value)) return "Cardiología";
  if (/revisión|review|seguimiento|follow/.test(value)) return "Revisión";
  if (/general|tos|cough|fiebre|fever|gripe|flu|cold/.test(value)) return "Medicina general";
  if (/alta|registr|new to the clinic|nuevo paciente/.test(value)) return "Alta de paciente";
  if (/horario|abr[ií]s|open|sábado|saturday|dirección|address/.test(value)) return "Información del centro";
  return "Otras consultas";
}

export function byConsultation(calls: LoggedCall[]) {
  const map = new Map<string, number>();
  for (const call of calls) {
    const type = consultationType(call.motive ?? "");
    map.set(type, (map.get(type) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
