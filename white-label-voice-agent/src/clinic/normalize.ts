/**
 * Normalización y ranking de disponibilidad.
 * Portado de `src/agent/tools.ts` de la rama de Lucía (fuente de verdad),
 * con una corrección marcada más abajo en `resolveDateRange`.
 */
import type {
  AvailabilityResponse,
  AvailabilitySlot,
  Insurer,
} from "../platform/types.ts";

const INSURERS = new Set<Insurer>([
  "sanitas",
  "adeslas",
  "dkv",
  "asisa",
  "mapfre",
  "caser",
  "cigna",
  "axa",
  "nueva_mutua",
  "privado",
]);

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

export function asInsurer(value: unknown): Insurer | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase() as Insurer;
  return INSURERS.has(key) ? key : undefined;
}

const SPECIALTY_ALIASES: Record<string, string> = {
  orthopedics: "orthopaedics",
  orthopedic: "orthopaedics",
  traumatology: "orthopaedics",
  gynecology: "gynaecology",
  pediatrics: "paediatrics",
  pediatric: "paediatrics",
  gp: "general_practice",
};

const LOCATION_ALIASES: Record<string, string> = {
  central: "centro",
  centre: "centro",
  center: "centro",
  arnold: "centro",
  sir: "sur",
  rnl: "sur",
  south: "sur",
  getafe: "sur",
  north: "norte",
};

const LOCATION_NAMES: Record<string, string> = {
  centro: "Arenal Centro",
  norte: "Arenal Norte",
  sur: "Arenal Sur",
};

/** El STT telefónico destroza los nombres de sede; de ahí los alias fonéticos. */
export function asLocation(value: unknown): string | undefined {
  const raw = asString(value)?.toLowerCase().replace(/[^a-z]/g, "");
  if (!raw) return undefined;
  if (raw.includes("sur") || raw.includes("sir") || raw.includes("rnl") || raw.includes("getafe")) {
    return "sur";
  }
  if (raw.includes("norte") || raw.includes("north")) return "norte";
  if (raw.includes("centro") || raw.includes("central") || raw.includes("arnold")) return "centro";
  return LOCATION_ALIASES[raw] ?? raw;
}

export function asSpecialty(value: unknown): string | undefined {
  const raw = asString(value)?.toLowerCase().replace(/\s+/g, "_");
  if (!raw) return undefined;
  return SPECIALTY_ALIASES[raw] ?? raw;
}

export function addYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** El juez congela los casos a las 09:00 Europe/Madrid. */
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

export function madridYmd(daysFromToday: number): string {
  return addYmd(clinicTodayYmd(), daysFromToday);
}

function madridParts(iso: string): { weekday: string; hour: number } {
  const date = new Date(iso);
  return {
    weekday: new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Madrid",
      weekday: "short",
    }).format(date),
    hour: Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(date),
    ),
  };
}

function isOutsideWeekdayMornings(iso: string): boolean {
  const { weekday, hour } = madridParts(iso);
  return weekday === "Sat" || weekday === "Sun" || hour >= 15;
}

const MAX_SPAN_DAYS = 14;

/**
 * CORRECCIÓN respecto a la rama de Lucía.
 *
 * Allí, si el modelo pedía una fecha futura sin `location_id` ni `provider_id`,
 * el rango se reseteaba a mañana:
 *
 *     if (!location_id && !provider_id && dateFrom > firstBookable) dateFrom = firstBookable;
 *
 * Eso provocaba dos fallos vistos en los logs del Run All: peticiones de
 * `date_from=2026-10-05` salían como `date_from=2026-09-19` (→ 422 "date range
 * cannot exceed 14 days"), y cuando no petaba, devolvía slots de una fecha que
 * nadie había pedido y el modelo acababa inventando días.
 *
 * Aquí se respeta lo que pide el modelo: solo se sube al primer día reservable
 * (nunca mismo día) y se recorta el rango a 14 días desde `date_from`.
 */
export function resolveDateRange(
  dateFromRaw: unknown,
  dateToRaw: unknown,
): { date_from: string; date_to: string } {
  const firstBookable = madridYmd(1);
  let from = asString(dateFromRaw) ?? firstBookable;
  if (from < firstBookable) from = firstBookable;

  let to = asString(dateToRaw) ?? addYmd(from, MAX_SPAN_DAYS - 1);
  if (to < from) to = from;
  const maxTo = addYmd(from, MAX_SPAN_DAYS - 1);
  if (to > maxTo) to = maxTo;

  return { date_from: from, date_to: to };
}

function slimSlot(slot: AvailabilitySlot) {
  const location_id = asLocation(slot.location_id) ?? slot.location_id;
  return {
    start_time: slot.start_time,
    provider_id: slot.provider_id,
    provider_name: slot.provider_name,
    location_id,
    location_name: LOCATION_NAMES[location_id] ?? slot.location_id,
    appointment_type_id: slot.appointment_type_id,
  };
}

/** Recorta la respuesta para que el modelo no se ahogue en slots. */
export function rankAvailability(data: AvailabilityResponse) {
  const sorted = [...data.slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const seen = new Set<string>();
  const picked: AvailabilitySlot[] = [];
  const take = (slot: AvailabilitySlot) => {
    const key = `${slot.provider_id}|${slot.location_id}|${slot.start_time}`;
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(slot);
  };
  for (const slot of sorted.slice(0, 12)) take(slot);
  for (const slot of sorted) {
    if (picked.length >= 18) break;
    if (isOutsideWeekdayMornings(slot.start_time)) take(slot);
  }
  const saturday = sorted
    .filter((slot) => madridParts(slot.start_time).weekday === "Sat")
    .slice(0, 4);
  return {
    soonest: sorted[0] ? slimSlot(sorted[0]) : null,
    saturday: saturday.map(slimSlot),
    slots: picked.map(slimSlot),
    appointment_type_id: data.appointment_type.id,
    blocked: data.blocked,
  };
}
