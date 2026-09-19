export function euro(n: number, digits = 0): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function num(n: number): string {
  return new Intl.NumberFormat("es-ES").format(Math.round(n));
}

export function hours(minutes: number): string {
  const h = minutes / 60;
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(h)} h`;
}

const MADRID = "Europe/Madrid";

/** "2026-09-19T09:32:56,376 CEST" → "09:32". Falls back to "—". */
export function timeOf(started: string | null | undefined): string {
  if (!started) return "—";
  const date = new Date(started.replace(",", ".").replace(/ CEST$/, "+02:00").replace(/ CET$/, "+01:00"));
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("es-ES", {
    timeZone: MADRID, hour: "2-digit", minute: "2-digit",
  }).format(date) : "—";
}

/** ISO slot → "lun 21 sep · 09:30" in Madrid time. */
export function slotLabel(slot: string | null | undefined): string {
  if (!slot) return "—";
  const date = new Date(slot);
  if (Number.isNaN(date.getTime())) return slot.replace("T", " ").slice(0, 16);
  const day = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: MADRID })
    .format(date)
    .replace(/\.$/, "");
  const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: MADRID }).format(date);
  return `${day} · ${time}`;
}

/** Today's date as "vie 19 sep". */
export function todayLabel(date = new Date()): string {
  return new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: MADRID })
    .format(date)
    .replace(/\.$/, "");
}

/** Percentage of `part` over `total`, rounded; 0 when total is 0. */
export function pct(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}
