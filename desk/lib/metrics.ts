import { INTENT_LABEL, reasonLabel, TOOL_LABEL } from "./labels";
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

/** Display the agent's recorded classification, without guessing a specialty from text. */
export function byConsultation(calls: LoggedCall[]) {
  const map = new Map<string, number>();
  for (const call of calls) {
    const name = call.intent ? INTENT_LABEL[call.intent] ?? call.intent.replaceAll("_", " ") : "Sin clasificar";
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** Tarifa de consulta y coste empresa de central. No es facturación del centro. */
export const VALUE_RATES = { visitEuro: 90, deskHourEuro: 18 } as const;

export function periodEconomics(calls: LoggedCall[]) {
  const citas = calls.filter((call) => call.outcome === "cita").length;
  const agent = calls.filter((call) => call.outcome !== "escalado");
  const desk = calls.filter((call) => call.outcome === "escalado");
  const agenda = citas * VALUE_RATES.visitEuro;
  const savedLabor = (lineMinutes(agent) / 60) * VALUE_RATES.deskHourEuro;
  const deskLabor = (lineMinutes(desk) / 60) * VALUE_RATES.deskHourEuro;
  return {
    citas,
    agenda,
    savedLabor,
    deskLabor,
    effect: agenda + savedLabor,
    agentMinutes: lineMinutes(agent),
    deskMinutes: lineMinutes(desk),
  };
}

/** Why an open call never became a cita, alta or derivación. */
export function openBreakdown(calls: LoggedCall[]) {
  const open = calls.filter((call) => call.outcome === "sin_cierre");
  let short = 0;
  let noTools = 0;
  let unfinished = 0;
  for (const call of open) {
    if (call.minutes != null && call.minutes < 0.5) short += 1;
    else if (!call.toolCalls && !call.actions?.length) noTools += 1;
    else unfinished += 1;
  }
  return { open: open.length, short, noTools, unfinished };
}

const LAST_ACTION_WHY: Record<string, string> = {
  search_availability: "Buscó hueco y no reservó",
  search_directory: "Identificó al paciente y no siguió",
  list_appointments: "Consultó la agenda y no actuó",
  submit_no_action: "Cerró sin acción",
};

/** Recorded reason for escalado / sin_cierre, from codes and last tool — not inferred from transcript. */
export function outcomeWhy(call: LoggedCall): string | null {
  const coded = reasonLabel(call.reason);
  if (coded) return coded;
  const last = call.actions?.at(-1);
  if (call.outcome === "escalado") {
    return (last?.reason ? reasonLabel(last.reason) : null) ?? "Pasó a una persona";
  }
  if (call.outcome !== "sin_cierre") return null;
  if (call.minutes != null && call.minutes < 0.5) return "Colgó enseguida";
  if (last?.name === "submit_no_action") {
    return reasonLabel(last.reason) ?? LAST_ACTION_WHY.submit_no_action;
  }
  if (last?.name && LAST_ACTION_WHY[last.name]) return LAST_ACTION_WHY[last.name];
  if (last?.name) return `Última acción: ${TOOL_LABEL[last.name] ?? last.name}`;
  if (!call.toolCalls) return "Habló sin consultar ficha ni agenda";
  return "No llegó a reservar";
}
