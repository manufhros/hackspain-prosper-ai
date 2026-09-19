import type { LoggedCall } from "./types";

export const ORIGIN_LABEL = { all: "Todas", phone: "Telefonía", simulator: "Pruebas", unknown: "Sin clasificar" };
export type OriginFilter = keyof typeof ORIGIN_LABEL;
export function originFilter(value: unknown): OriginFilter {
  return typeof value === "string" && Object.hasOwn(ORIGIN_LABEL, value) ? value as OriginFilter : "all";
}

export function madridDay(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Calendar midnight in Madrid, including 23/25-hour daylight-saving days. */
export function todayRange(now = new Date()) {
  const day = madridDay(now);
  const midnight = (ymd: string) => {
    const wall = Date.parse(`${ymd}T00:00:00Z`);
    let utc = wall;
    for (let i = 0; i < 3; i++) {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" }).formatToParts(new Date(utc));
      const offset = parts.find(part => part.type === "timeZoneName")!.value.match(/GMT([+-])(\d{2}):(\d{2})/)!;
      utc = wall - (offset[1] === "+" ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000;
    }
    return new Date(utc).toISOString();
  };
  const tomorrow = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { day, from: midnight(day), to: midnight(tomorrow) };
}

export function callCounts(calls: LoggedCall[]) {
  return {
    calls: calls.length,
    citas: calls.filter(call => call.outcome === "cita").length,
    altas: calls.filter(call => call.outcome === "alta").length,
    esc: calls.filter(call => call.outcome === "escalado").length,
    active: calls.filter(call => call.outcome === "en_curso").length,
    unresolved: calls.filter(call => call.outcome === "sin_cierre").length,
    measured: calls.filter(call => call.minutes != null).length,
  };
}
