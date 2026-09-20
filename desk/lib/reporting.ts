import { isRecordedCall } from "./call-enrichment";
import { parseCallStarted } from "./format";
import type { LoggedCall } from "./types";

export type PeakRow = { label: string; value: number };

export const ORIGIN_LABEL = { all: "Todas", phone: "Agente", simulator: "Ensayo", unknown: "Sin clasificar" };
export type OriginFilter = keyof typeof ORIGIN_LABEL;
export function originFilter(value: unknown): OriginFilter {
  return typeof value === "string" && Object.hasOwn(ORIGIN_LABEL, value) ? value as OriginFilter : "all";
}

/** Who closed the call on the hospital line. Simulator rehearsals stay out of this board. */
export const LINE_LABEL = { all: "Todas", agent: "Agente", desk: "Central" };
export type LineFilter = keyof typeof LINE_LABEL;
export function lineFilter(value: unknown): LineFilter {
  if (value === "agent" || value === "phone") return "agent";
  if (value === "desk") return "desk";
  return "all";
}

export function isDeskCall(call: LoggedCall) {
  return call.outcome === "escalado";
}

export function lineCalls(calls: LoggedCall[]) {
  return calls.filter((call) => call.origin !== "simulator" && isRecordedCall(call));
}

export function filterLine(calls: LoggedCall[], line: LineFilter) {
  const live = lineCalls(calls);
  if (line === "all") return live;
  if (line === "desk") return live.filter(isDeskCall);
  return live.filter((call) => !isDeskCall(call));
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

export const OVERVIEW_DAYS = 7;

/** Inclusive Madrid calendar window ending today. */
export function recentRange(now = new Date(), days = OVERVIEW_DAYS) {
  const end = todayRange(now);
  const startAt = new Date(Date.parse(`${end.day}T12:00:00Z`) - (Math.max(1, days) - 1) * 86_400_000);
  const start = todayRange(startAt);
  return { ...end, from: start.from, days: Math.max(1, days) };
}

export type PeakPoint = {
  at: string;
  total: number;
  escalado: number;
  abierto: number;
};

/** Hourly call volume across the range, for a time-series chart. */
export function peakTimeline(calls: LoggedCall[], range: { from: string; to: string }): PeakPoint[] {
  const start = Date.parse(range.from);
  const end = Date.parse(range.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const hour = 3_600_000;
  const count = Math.max(1, Math.round((end - start) / hour));
  const buckets: PeakPoint[] = Array.from({ length: count }, (_, i) => ({
    at: new Date(start + i * hour).toISOString(),
    total: 0,
    escalado: 0,
    abierto: 0,
  }));
  for (const call of calls) {
    const date = parseCallStarted(call.started);
    if (!date) continue;
    const i = Math.floor((date.getTime() - start) / hour);
    const bucket = buckets[i];
    if (!bucket) continue;
    bucket.total += 1;
    if (call.outcome === "escalado") bucket.escalado += 1;
    if (call.outcome === "sin_cierre") bucket.abierto += 1;
  }
  return buckets;
}

export function hourlyPeaks(calls: LoggedCall[]): PeakRow[] {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    label: `${hour} h`,
    value: 0,
  }));
  for (const call of calls) {
    const date = parseCallStarted(call.started);
    if (!date) continue;
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Madrid" }).format(date),
    );
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) hours[hour]!.value += 1;
  }
  const first = hours.findIndex((row) => row.value > 0);
  const last = hours.findLastIndex((row) => row.value > 0);
  if (first < 0) return [{ label: "—", value: 0 }];
  return hours.slice(first, last + 1);
}

export function dailyPeaks(calls: LoggedCall[], range: { from: string; days: number }): PeakRow[] {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const date = parseCallStarted(call.started);
    if (!date) continue;
    const key = madridDay(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows: PeakRow[] = [];
  for (let i = 0; i < range.days; i++) {
    const date = new Date(Date.parse(range.from) + i * 86_400_000 + 12 * 3_600_000);
    const key = madridDay(date);
    const label = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", timeZone: "Europe/Madrid" })
      .format(date)
      .replace(/\.$/, "");
    rows.push({ label, value: counts.get(key) ?? 0 });
  }
  return rows.some((row) => row.value) ? rows : [{ label: "—", value: 0 }];
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
