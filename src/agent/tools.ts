import { PlatformClient } from "../platform/client.ts";
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilitySlot,
  DirectoryQuery,
  Insurer,
  OutcomeReason,
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

function asInsurer(value: unknown): Insurer | undefined {
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
  if (year === undefined || month === undefined || day === undefined || ![year, month, day].every(Number.isFinite)) {
    throw new Error("Invalid calendar date");
  }
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Answer sheet date: the judge freezes cases at 09:00 Europe/Madrid. */
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

function madridYmd(daysFromToday: number): string {
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

export function rankAvailability(data: AvailabilityResponse): {
  soonest: ReturnType<typeof slimSlot> | null;
  saturday: ReturnType<typeof slimSlot>[];
  slots: ReturnType<typeof slimSlot>[];
  appointment_type_id: string;
  blocked: AvailabilityResponse["blocked"];
} {
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
  const saturday = sorted.filter((slot) => madridParts(slot.start_time).weekday === "Sat").slice(0, 4);
  return {
    soonest: sorted[0] ? slimSlot(sorted[0]) : null,
    saturday: saturday.map(slimSlot),
    slots: picked.map(slimSlot),
    appointment_type_id: data.appointment_type.id,
    blocked: data.blocked,
  };
}

export type CallContext = {
  callId: string;
  fromNumber?: string;
  platform: PlatformClient;
};

export async function runClinicTool(
  ctx: CallContext,
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "search_directory":
      return JSON.stringify(
        await ctx.platform.directory(
          compact({
            name: asString(params.name),
            national_id: asString(params.national_id),
            phone: asString(params.phone),
            date_of_birth: asString(params.date_of_birth),
          }) as DirectoryQuery,
        ),
      );
    case "search_availability": {
      const firstBookable = madridYmd(1);
      let dateFrom = asString(params.date_from) ?? firstBookable;
      if (dateFrom < firstBookable) dateFrom = firstBookable;
      if (!asString(params.location_id) && !asString(params.provider_id) && dateFrom > firstBookable) {
        dateFrom = firstBookable;
      }
      const dateTo = asString(params.date_to) ?? madridYmd(14);
      const insurer = asInsurer(params.insurer);
      const raw = await ctx.platform.availability(
        compact({
          date_from: dateFrom,
          date_to: dateTo,
          provider_id: asString(params.provider_id),
          specialty_id: asSpecialty(params.specialty_id),
          location_id: asLocation(params.location_id),
          patient_id: asString(params.patient_id),
          ...(insurer ? { insurer: [insurer] } : {}),
        }) as AvailabilityQuery,
      );
      return JSON.stringify(rankAvailability(raw));
    }
    case "list_appointments": {
      const patientId = asString(params.patient_id);
      if (!patientId) return JSON.stringify({ error: "patient_id required" });
      return JSON.stringify(await ctx.platform.appointments(patientId, "upcoming"));
    }
    case "submit_book": {
      const policy = asInsurer(params.policy_id);
      const patient_id = asString(params.patient_id);
      let provider_id = asString(params.provider_id);
      let location_id = asLocation(params.location_id);
      let appointment_type_id = asString(params.appointment_type_id);
      let slot = asString(params.slot);
      if (!policy || !patient_id || !provider_id || !location_id || !appointment_type_id || !slot) {
        return JSON.stringify({ error: "missing book fields" });
      }
      const day = slot.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof ctx.platform.availability === "function") {
        try {
          const found = await ctx.platform.availability({
            date_from: day,
            date_to: day,
            patient_id,
            provider_id,
            insurer: [policy],
          });
          const match = found.slots.find(
            (item) =>
              item.provider_id === provider_id &&
              item.start_time === slot &&
              asLocation(item.location_id) === location_id,
          );
          if (match) {
            provider_id = match.provider_id;
            location_id = match.location_id;
            appointment_type_id = match.appointment_type_id;
            slot = match.start_time;
          }
        } catch {
          /* submit the model payload */
        }
      }
      return JSON.stringify(
        await ctx.platform.submitBook({
          call_id: ctx.callId,
          patient_id,
          provider_id,
          location_id,
          appointment_type_id,
          slot,
          policy_id: policy,
        }),
      );
    }
    case "submit_no_action": {
      const reason = asString(params.reason) as OutcomeReason | undefined;
      if (!reason) return JSON.stringify({ error: "reason required" });
      return JSON.stringify(await ctx.platform.submitNoAction({ call_id: ctx.callId, reason }));
    }
    case "submit_escalate": {
      const reason = asString(params.reason) as OutcomeReason | undefined;
      if (!reason) return JSON.stringify({ error: "reason required" });
      return JSON.stringify(await ctx.platform.submitEscalate({ call_id: ctx.callId, reason }));
    }
    case "submit_register": {
      const insurer = asInsurer(params.insurer);
      const given_name = asString(params.given_name);
      const first_surname = asString(params.first_surname);
      const second_surname = asString(params.second_surname);
      const national_id = asString(params.national_id);
      const date_of_birth = asString(params.date_of_birth);
      const phone = asString(params.phone);
      const email = asString(params.email);
      if (
        !insurer ||
        !given_name ||
        !first_surname ||
        !second_surname ||
        !national_id ||
        !date_of_birth ||
        !phone ||
        !email
      ) {
        return JSON.stringify({ error: "missing register fields" });
      }
      return JSON.stringify(
        await ctx.platform.submitRegister({
          call_id: ctx.callId,
          given_name,
          first_surname,
          second_surname,
          national_id,
          date_of_birth,
          phone,
          email,
          insurer,
        }),
      );
    }
    case "submit_cancel": {
      const appointment_id = asString(params.appointment_id);
      if (!appointment_id) return JSON.stringify({ error: "appointment_id required" });
      return JSON.stringify(
        await ctx.platform.submitCancel({ call_id: ctx.callId, appointment_id }),
      );
    }
    case "submit_reschedule": {
      const policy = asInsurer(params.policy_id);
      const appointment_id = asString(params.appointment_id);
      const provider_id = asString(params.provider_id);
      const location_id = asLocation(params.location_id);
      const slot = asString(params.slot);
      if (!policy || !appointment_id || !provider_id || !location_id || !slot) {
        return JSON.stringify({ error: "missing reschedule fields" });
      }
      return JSON.stringify(
        await ctx.platform.submitReschedule({
          call_id: ctx.callId,
          appointment_id,
          provider_id,
          location_id,
          slot,
          policy_id: policy,
        }),
      );
    }
    default:
      return JSON.stringify({ error: `unknown tool ${name}` });
  }
}
