import type { LoggedCall } from "./types";

/** Hipótesis comerciales. No salen del log. */
export const SALES = {
  ticket: 128,
  newPatient: 390,
  hour: 41,
  minutes: 7,
  days: 220,
  fteYear: 47_200,
  missedWithout: 0.19,
  agentMinute: 0.19,
};

export function pitch(calls: LoggedCall[]) {
  const citas = calls.filter((c) => c.outcome === "cita").length;
  const altas = calls.filter((c) => c.outcome === "alta").length;
  const esc = calls.filter((c) => c.outcome === "escalado").length;
  const closed = calls.filter((c) => c.outcome !== "sin_cierre").length;
  const total = calls.length || 1;
  const agendaDay = citas * SALES.ticket;
  const agendaYear = agendaDay * SALES.days;
  const deskDay = (closed * SALES.minutes * SALES.hour) / 60;
  const deskYear = deskDay * SALES.days;
  const missedYear = Math.round(calls.length * SALES.missedWithout) * SALES.ticket * SALES.days;
  const pipelineYear = altas * SALES.newPatient * SALES.days;
  return {
    citas,
    altas,
    esc,
    calls: calls.length,
    closed,
    agendaDay,
    agendaYear,
    deskDay,
    deskYear,
    missedYear,
    pipelineYear,
    ftes: deskYear / SALES.fteYear,
    kept: Math.round((1 - esc / total) * 100),
    booked: Math.round((citas / total) * 100),
  };
}
