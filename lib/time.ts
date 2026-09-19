export function addYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    ![year, month, day].every(Number.isFinite)
  ) {
    throw new Error(`Invalid calendar date: ${ymd}`);
  }
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Public cases freeze at 09:00 Europe/Madrid. */
export function clinicTodayYmd(now = new Date()): string {
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

export function diffYmd(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function shiftIsoDays(iso: string, days: number): string {
  if (!days) return iso;
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})(T.*)$/);
  if (match?.[1] && match[2]) return `${addYmd(match[1], days)}${match[2]}`;
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
