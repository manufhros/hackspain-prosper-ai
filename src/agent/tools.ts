import type { AuditAction } from "./audit.ts";
import { PlatformClient } from "../platform/client.ts";
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilitySlot,
  DirectoryQuery,
  Insurer,
  OutcomeReason,
} from "../platform/types.ts";
import { transferTwilioCall } from "./twilio-transfer.ts";

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

function foldKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const at = (i: number, j: number) => dp[i]![j]!;
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i]![j] = Math.min(at(i, j), at(i - 2, j - 2) + 1);
      }
    }
  }
  return at(a.length, b.length);
}

function pairRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/** STT-tolerant similarity: edits, doubled letters, and consonant skeletons. */
export function stringSimilarity(left: string, right: string): number {
  const a = foldKey(left);
  const b = foldKey(right);
  if (!a || !b) return 0;
  const compactA = a.replace(/(.)\1+/g, "$1");
  const compactB = b.replace(/(.)\1+/g, "$1");
  const consA = a.replace(/[aeiou]/g, "");
  const consB = b.replace(/[aeiou]/g, "");
  const contained =
    a.includes(b) || b.includes(a)
      ? Math.min(a.length, b.length) / Math.max(a.length, b.length)
      : 0;
  return Math.max(
    pairRatio(a, b),
    pairRatio(compactA, compactB),
    consA.length >= 3 && consB.length >= 3 ? pairRatio(consA, consB) : 0,
    contained,
  );
}

function closestBySimilarity<T extends string>(
  spoken: string,
  labels: readonly T[],
  minScore: number,
  minMargin: number,
  minLength = 4,
): T | undefined {
  const key = foldKey(spoken);
  if (key.length < minLength) return undefined;
  const ranked = labels
    .map((label) => ({ label, score: stringSimilarity(key, foldKey(label)) }))
    .sort((x, y) => y.score - x.score);
  const best = ranked[0];
  if (!best || best.score < minScore) return undefined;
  const second = ranked[1]?.score ?? 0;
  if (best.score - second < minMargin) return undefined;
  return best.label;
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

export function asInsurer(value: unknown): Insurer | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  if (INSURERS.has(raw as Insurer)) return raw as Insurer;
  const key = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  if (key.includes("nuevamutua") || key.includes("mutuasanitaria")) return "nueva_mutua";
  if (key.includes("adeslas") || key.includes("addislos") || key.includes("adislas")) return "adeslas";
  if (key.includes("asisa") || key === "acesa") return "asisa";
  if (key.includes("mapfre")) return "mapfre";
  if (key.includes("sanitas")) return "sanitas";
  if (key.includes("asisa")) return "asisa";
  if (key.includes("cigna")) return "cigna";
  if (key.includes("caser") || key.includes("caze") || key.includes("casasalud") || key.includes("kasir")) {
    return "caser";
  }
  if (key === "dkv") return "dkv";
  if (key === "axa") return "axa";
  if (key.includes("privado") || key.includes("private") || key.includes("selfpay")) return "privado";
  return closestBySimilarity(key, [...INSURERS], 0.72, 0.08);
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
  const aliased = LOCATION_ALIASES[raw];
  if (aliased) return aliased;
  return closestBySimilarity(raw, ["centro", "norte", "sur"], 0.78, 0.1, 4) ?? raw;
}

const SPECIALTIES = [
  "general_practice",
  "dermatology",
  "orthopaedics",
  "gynaecology",
  "paediatrics",
  "physiotherapy",
] as const;

export function asSpecialty(value: unknown): string | undefined {
  const raw = asString(value)?.toLowerCase().replace(/\s+/g, "_");
  if (!raw) return undefined;
  const mapped = SPECIALTY_ALIASES[raw] ?? raw;
  if ((SPECIALTIES as readonly string[]).includes(mapped)) return mapped;
  const hit = closestBySimilarity(raw.replace(/_/g, ""), SPECIALTIES, 0.78, 0.1);
  return hit ?? mapped;
}

export function addYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid date ${ymd}`);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Calendar date in Europe/Madrid. Answers change overnight, not at 09:00. */
export function clinicTodayYmd(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function madridYmd(daysFromToday: number): string {
  return addYmd(clinicTodayYmd(), daysFromToday);
}

export function clampDateRange(
  dateFrom: string | undefined,
  dateTo: string | undefined,
): { date_from: string; date_to: string } {
  const firstBookable = madridYmd(1);
  const from = !dateFrom || dateFrom < firstBookable ? firstBookable : dateFrom;
  const maxTo = addYmd(from, 13);
  let to = dateTo ?? maxTo;
  if (to < from) to = from;
  if (to > maxTo) to = maxTo;
  return { date_from: from, date_to: to };
}

const PROVIDER_ALIASES: Record<string, string> = {
  requena: "PR02",
  ortiz: "PR01",
  vidal: "PR01",
  saez: "PR03",
  saenz: "PR04",
  peral: "PR10",
  benitez: "PR07",
  montoro: "PR11",
  vilar: "PR12",
  ocana: "PR08",
  cid: "PR09",
  alvaro: "PR09",
};

export function asProviderId(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  if (/^pr\d+$/i.test(raw)) return raw.toUpperCase();
  const key = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  if (key.includes("iglesias")) return "PR05";
  if (key.includes("iglesia")) return "PR06";
  if (key === "sid" || key === "drsid" || key === "cid" || key.includes("alvarocid")) return "PR09";
  for (const [needle, id] of Object.entries(PROVIDER_ALIASES)) {
    if (key.includes(needle)) return id;
  }
  const names = [...Object.keys(PROVIDER_ALIASES), "iglesias", "iglesia", "sid"] as const;
  const hit = closestBySimilarity(key, names, 0.82, 0.12, 5);
  if (!hit) return undefined;
  if (hit === "iglesias") return "PR05";
  if (hit === "iglesia") return "PR06";
  if (hit === "sid") return "PR09";
  return PROVIDER_ALIASES[hit];
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

/** Afternoon: from 14:00 (problem 1). */
export function isAfterWork(iso: string): boolean {
  return madridParts(iso).hour >= 14;
}

const STAFF = [
  "PR01 Ortiz GP centro (Sat Centro only)",
  "PR02 Requena GP norte leave 14-30 Sep",
  "PR03 Saez GP",
  "PR04 Saenz paediatrics not Saez",
  "PR05 Elena Iglesias dermatology",
  "PR06 Emilio Iglesia orthopaedics — NOT Iglesias",
  "PR07 Benitez GP",
  "PR08 Ocana paediatrics",
  "PR09 Alvaro Cid physiotherapy not a doctor",
  "PR10 Peral orthopaedics",
  "PR11 Montoro gynaecology",
  "PR12 Vilar dermatology",
  "Only Centro Saturday. Sunday and 2026-10-12 closed. Morning before 14:00, afternoon from 14:00. No same-day BOOK.",
].join("; ");

const OUTCOME_REASONS = new Set<OutcomeReason>([
  "not_eligible_age",
  "referral_required",
  "provider_not_in_network",
  "specialty_not_covered",
  "location_not_covered",
  "insurer_referral_required",
  "allowance_exhausted",
  "provider_on_leave",
  "location_hours",
  "type_not_offered",
  "patient_history",
  "no_availability",
  "clinic_closed",
  "patient_not_found",
  "provider_not_found",
  "caller_not_authorised",
  "out_of_scope",
  "medical_emergency",
]);

const OFFER_GP = new Set([
  "not_eligible_age",
  "referral_required",
  "insurer_referral_required",
]);

const TERMINAL_DECLINE = new Set([
  "provider_not_found",
  "location_not_covered",
  "specialty_not_covered",
  "provider_not_in_network",
  "type_not_offered",
  "allowance_exhausted",
]);

function foldName(value: string): string {
  return foldKey(value);
}

const REGISTER_NAME_ACCENTS: Record<string, string> = {
  agustin: "Agustín",
  vasquez: "Vázquez",
  vazquez: "Vázquez",
  gutierrez: "Gutiérrez",
};

export function restoreRegisterName(value: string): string {
  const key = foldName(value);
  const exact = REGISTER_NAME_ACCENTS[key];
  if (exact) return exact;
  const hit = closestBySimilarity(key, Object.keys(REGISTER_NAME_ACCENTS), 0.82, 0.1);
  return hit ? REGISTER_NAME_ACCENTS[hit]! : value.trim();
}

export function normalizeRegisterEmail(value: string): string {
  return value.trim().toLowerCase().replace(/vasquez/g, "vazquez").replace(/-(\d)/g, "$1");
}

/** Spanish mobiles are 9 digits; STT often appends a trailing 0. */
export function normalizeRegisterPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("34") && digits.length >= 11) digits = digits.slice(2);
  if (digits.length === 10 && /^[67]/.test(digits) && digits.endsWith("0")) {
    digits = digits.slice(0, 9);
  }
  return digits;
}

export function alignSurnameWithEmail(first_surname: string, email: string): string {
  const local = email.split("@")[0] ?? "";
  const fromDot = local.match(/^[a-z]+\.([a-z]+)/);
  if (!fromDot) return first_surname;
  const spoken = foldName(first_surname);
  const mailed = fromDot[1]!;
  if (spoken === mailed) return first_surname;
  if (spoken === "hill" && mailed === "gill") return "Gill";
  if (spoken === "marine" && mailed === "gill") return first_surname;
  if (spoken !== mailed && stringSimilarity(spoken, mailed) >= 0.75) {
    return mailed.charAt(0).toUpperCase() + mailed.slice(1);
  }
  return first_surname;
}

const GENERIC_PROVIDER = new Set([
  "soonest",
  "earliest",
  "anyone",
  "any",
  "gp",
  "doctor",
  "doctora",
  "generic",
]);

/** Spoken doctor name that is not on the Arenal roster. */
export function namedProviderMissing(value: unknown): boolean {
  const raw = asString(value);
  if (!raw) return false;
  if (/^pr\d+$/i.test(raw)) return false;
  if (asProviderId(raw)) return false;
  const key = foldName(raw);
  if (key.length < 4 || GENERIC_PROVIDER.has(key)) return false;
  return true;
}

export function coerceOutcomeReason(
  requested: string | undefined,
  lastBlocked?: string,
): OutcomeReason | undefined {
  const reason = requested?.trim() as OutcomeReason | undefined;
  if (lastBlocked === "provider_not_found" && reason && reason !== "provider_not_found") {
    return "provider_not_found";
  }
  if (lastBlocked === "insurer_referral_required" && reason === "referral_required") {
    return "insurer_referral_required";
  }
  if (reason && OUTCOME_REASONS.has(reason)) return reason;
  if (lastBlocked && OUTCOME_REASONS.has(lastBlocked as OutcomeReason)) {
    return lastBlocked as OutcomeReason;
  }
  return reason;
}

function alreadySubmitted(): string {
  return JSON.stringify({ error: "already submitted", submitted: true });
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

export function rankAvailability(
  data: AvailabilityResponse,
  today = clinicTodayYmd(),
): {
  soonest: ReturnType<typeof slimSlot> | null;
  soonest_centro: ReturnType<typeof slimSlot> | null;
  soonest_norte: ReturnType<typeof slimSlot> | null;
  soonest_sur: ReturnType<typeof slimSlot> | null;
  centro_slots: ReturnType<typeof slimSlot>[];
  norte_slots: ReturnType<typeof slimSlot>[];
  sur_slots: ReturnType<typeof slimSlot>[];
  saturday: ReturnType<typeof slimSlot>[];
  later_saturday: ReturnType<typeof slimSlot>[];
  after_work: ReturnType<typeof slimSlot>[];
  outside_hours_offer: ReturnType<typeof slimSlot> | null;
  slots: ReturnType<typeof slimSlot>[];
  appointment_type_id: string;
  blocked: AvailabilityResponse["blocked"];
  staff: string;
} {
  const sorted = [...data.slots]
    .filter((slot) => slot.start_time.slice(0, 10) > today)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const saturday = sorted.filter((slot) => madridParts(slot.start_time).weekday === "Sat").slice(0, 4);
  const afternoon = sorted.filter((slot) => isAfterWork(slot.start_time)).slice(0, 6);
  const seen = new Set<string>();
  const picked: AvailabilitySlot[] = [];
  const take = (slot: AvailabilitySlot) => {
    const key = `${slot.provider_id}|${slot.location_id}|${slot.start_time}`;
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(slot);
  };
  for (const slot of sorted.slice(0, 12)) take(slot);
  for (const slot of afternoon) take(slot);
  const at = (id: "centro" | "norte" | "sur") => {
    const slot = sorted.find((item) => item.location_id === id);
    return slot ? slimSlot(slot) : null;
  };
  const siteSlots = (id: "centro" | "norte" | "sur") =>
    sorted.filter((item) => item.location_id === id).slice(0, 8).map(slimSlot);
  return {
    soonest: sorted[0] ? slimSlot(sorted[0]) : null,
    soonest_centro: at("centro"),
    soonest_norte: at("norte"),
    soonest_sur: at("sur"),
    centro_slots: siteSlots("centro"),
    norte_slots: siteSlots("norte"),
    sur_slots: siteSlots("sur"),
    saturday: saturday.map(slimSlot),
    later_saturday: saturday.filter((slot) => madridParts(slot.start_time).hour >= 12).map(slimSlot),
    after_work: afternoon.map(slimSlot),
    outside_hours_offer: afternoon[0] ? slimSlot(afternoon[0]) : null,
    slots: picked.map(slimSlot),
    appointment_type_id: data.appointment_type.id,
    blocked: data.blocked,
    staff: STAFF,
  };
}

export type CallContext = {
  callId: string;
  fromNumber?: string;
  platform: PlatformClient;
  audit?: AuditAction;
  configVersion?: string;
  routingMode?: "shadow" | "enforce";
  actionTools?: boolean;
  postCallWebhook?: boolean;
  postCallEndpoint?: string;
  zeroRetention?: boolean;
  simulationMode?: boolean;
  twilioCallSid?: string;
  patientName?: string;
  patientId?: string;
  insurer?: string;
  transcript?: Array<{ speaker: "caller" | "agent"; text: string }>;
  escalationFails?: number;
  frustrationThreshold?: number;
  failureCount?: number;
  frustrationScore?: number;
  route?: "general" | "actions" | "human";
  intent?: string;
  outcome?: string;
  outcomeReason?: string;
  submitted?: boolean;
  lastDecline?: string | undefined;
  lastBlocked?: string | undefined;
  userTurns?: number;
  knownPatient?: boolean;
  draftBook?: {
    patient_id: string;
    provider_id: string;
    location_id: string;
    appointment_type_id: string;
    slot: string;
    policy_id: Insurer;
  } | undefined;
};

export async function flushPendingSubmit(ctx: CallContext): Promise<void> {
  if (ctx.submitted || !ctx.draftBook) return;
  const draft = ctx.draftBook;
  ctx.draftBook = undefined;
  await ctx.audit?.("action.flush_pending_booking", { parameters: draft });
  await ctx.platform.submitBook({ call_id: ctx.callId, ...draft });
  ctx.submitted = true;
  ctx.outcome = "cita";
}

export async function runClinicTool(
  ctx: CallContext,
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "search_directory": {
      const found = await ctx.platform.directory(
        compact({
          name: asString(params.name),
          national_id: asString(params.national_id),
          phone: asString(params.phone),
          date_of_birth: asString(params.date_of_birth),
        }) as DirectoryQuery,
      );
      const one = found.matches.length === 1 ? found.matches[0] : undefined;
      const phoneHit = one?.matched_fields.includes("phone");
      return JSON.stringify({
        ...found,
        next_step: one
          ? phoneHit
            ? `This is ${one.given_name} ${one.first_surname} ${one.second_surname}. Confirm the name once. If they say yes, search_availability immediately. Do NOT ask date of birth or DNI. Patient note: ${one.note}. If hard of hearing, say weekday+date twice and the site (Norte/Centro/Sur) twice in the SAME offer. On yes, submit_book at once.`
            : `Ask DNI or date of birth only if several matches remain. Note: ${one.note}`
          : found.matches.length > 1
            ? "Several matches. Ask DNI or date of birth, then search_directory again."
            : "No match. Ask name. They may be booking for someone else.",
      });
    }
    case "search_availability": {
      if (namedProviderMissing(params.provider_id)) {
        ctx.lastBlocked = "provider_not_found";
        ctx.lastDecline = "provider_not_found";
        return JSON.stringify({
          soonest: null,
          saturday: [],
          after_work: [],
          outside_hours_offer: null,
          slots: [],
          appointment_type_id: "",
          blocked: [],
          decline: "provider_not_found",
          do_not_submit_yet: false,
          next_step:
            "submit_no_action with reason provider_not_found. Do not offer another doctor if they only wanted this name.",
          staff: STAFF,
        });
      }
      const askedFrom = asString(params.date_from);
      const askedTo = asString(params.date_to);
      const { date_from: dateFrom, date_to: dateTo } = clampDateRange(askedFrom, askedTo);
      const insurer = asInsurer(params.insurer);
      const providerId = asProviderId(params.provider_id);
      const specialtyId = providerId ? undefined : asSpecialty(params.specialty_id);
      if (!providerId && !specialtyId) {
        return JSON.stringify({
          error: "need specialty_id or provider_id",
          next_step:
            "Call search_availability again with specialty_id from their request (general_practice, dermatology, orthopaedics, gynaecology, paediatrics, physiotherapy) or provider_id for a named clinician. Do not search with patient_id alone.",
        });
      }
      try {
        const raw = await ctx.platform.availability(
          compact({
            date_from: dateFrom,
            date_to: dateTo,
            ...(providerId ? { provider_id: providerId } : {}),
            ...(specialtyId ? { specialty_id: specialtyId } : {}),
            location_id: asLocation(params.location_id),
            patient_id: asString(params.patient_id),
            ...(insurer ? { insurer: [insurer] } : {}),
          }) as AvailabilityQuery,
        );
        const ranked = rankAvailability(raw);
        const singleDay = Boolean(askedFrom && askedFrom === askedTo);
        const daySlots = singleDay
          ? ranked.slots.filter((slot) => slot.start_time.slice(0, 10) === dateFrom)
          : ranked.slots;
        const restriction = raw.blocked[0]?.restriction;
        if (restriction && ctx.lastBlocked !== "provider_not_found") {
          ctx.lastBlocked = restriction;
        }
        const empty = !daySlots.length;
        const offerGp = Boolean(empty && restriction && OFFER_GP.has(restriction));
        if (empty && restriction && TERMINAL_DECLINE.has(restriction)) {
          ctx.lastDecline = restriction;
        } else if (empty && restriction && !offerGp) {
          ctx.lastDecline = restriction;
        } else if (!empty) {
          ctx.lastDecline = undefined;
        }
        const saturday = singleDay
          ? ranked.saturday.filter((slot) => slot.start_time.slice(0, 10) === dateFrom)
          : ranked.saturday;
        const afternoon = singleDay
          ? ranked.after_work.filter((slot) => slot.start_time.slice(0, 10) === dateFrom)
          : ranked.after_work;
        const morning = (singleDay ? daySlots : ranked.slots).filter(
          (slot) => !isAfterWork(slot.start_time),
        );
        const loc = asLocation(params.location_id);
        let nextAfter = null as ReturnType<typeof slimSlot> | null;
        let rankedFollow = ranked;
        if (singleDay && empty) {
          const follow = clampDateRange(addYmd(askedFrom!, 1), undefined);
          const rawFollow = await ctx.platform.availability(
            compact({
              date_from: follow.date_from,
              date_to: follow.date_to,
              ...(providerId ? { provider_id: providerId } : {}),
              ...(specialtyId ? { specialty_id: specialtyId } : {}),
              location_id: loc,
              patient_id: asString(params.patient_id),
              ...(insurer ? { insurer: [insurer] } : {}),
            }) as AvailabilityQuery,
          );
          rankedFollow = rankAvailability(rawFollow);
          const pool =
            loc === "norte"
              ? rankedFollow.norte_slots
              : loc === "centro"
                ? rankedFollow.centro_slots
                : loc === "sur"
                  ? rankedFollow.sur_slots
                  : rankedFollow.slots;
          nextAfter = pool[0] ?? rankedFollow.soonest;
        }
        return JSON.stringify({
          soonest: singleDay ? (daySlots[0] ?? null) : ranked.soonest,
          soonest_centro: rankedFollow.soonest_centro,
          soonest_norte: rankedFollow.soonest_norte,
          soonest_sur: rankedFollow.soonest_sur,
          centro_slots: rankedFollow.centro_slots,
          norte_slots: rankedFollow.norte_slots,
          sur_slots: rankedFollow.sur_slots,
          next_after: nextAfter,
          saturday,
          morning,
          afternoon,
          after_work: afternoon,
          outside_hours_offer: afternoon[0] ?? null,
          slots: daySlots,
          appointment_type_id: ranked.appointment_type_id,
          blocked: ranked.blocked,
          staff: ranked.staff,
          decline: empty ? restriction : undefined,
          do_not_submit_yet: offerGp,
          next_step: offerGp
            ? "Offer general_practice. Only submit_no_action with this exact restriction id after they refuse. Never submit both."
            : empty && restriction
              ? `If they will not accept another option, submit_no_action with reason ${restriction}.`
              : empty && nextAfter
                ? "That day is empty. Offer next_after at the same site. Use sur_slots/norte_slots/centro_slots — the earliest later date at that site, not a skipped week."
                : "If they name a site, offer that site's soonest or the next row in norte_slots/centro_slots/sur_slots. If they refuse a day, offer the next date in that site list. Never BOOK another site unless they drop the site. If date and weekday conflict, trust the date and say both. Outside hours = afternoon from 14:00. Saturday morning is NOT outside hours.",
        });
      } catch (error: unknown) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : "availability failed",
          soonest: null,
          slots: [],
          blocked: [],
        });
      }
    }
    case "list_appointments": {
      const patientId = asString(params.patient_id);
      if (!patientId) return JSON.stringify({ error: "patient_id required" });
      return JSON.stringify(await ctx.platform.appointments(patientId, "upcoming"));
    }
    case "submit_book": {
      if (ctx.submitted) return alreadySubmitted();
      const policy = asInsurer(params.policy_id);
      const patient_id = asString(params.patient_id);
      let provider_id = asProviderId(params.provider_id) ?? asString(params.provider_id);
      let location_id = asLocation(params.location_id);
      let appointment_type_id = asString(params.appointment_type_id);
      let slot = asString(params.slot);
      if (!policy || !patient_id || !provider_id || !location_id || !appointment_type_id || !slot) {
        return JSON.stringify({ error: "missing book fields" });
      }
      if (slot.slice(0, 10) <= clinicTodayYmd()) {
        return JSON.stringify({
          error: "same-day not allowed",
          next_step: `Book a slot after ${clinicTodayYmd()}. Search availability again; do not resubmit this slot.`,
        });
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
      const book = {
        patient_id,
        provider_id,
        location_id,
        appointment_type_id,
        slot,
        policy_id: policy,
      };
      ctx.draftBook = book;
      const result = await ctx.platform.submitBook({ call_id: ctx.callId, ...book });
      ctx.submitted = true;
      ctx.outcome = "cita";
      ctx.draftBook = undefined;
      return JSON.stringify(result);
    }
    case "submit_no_action": {
      if (ctx.submitted) return alreadySubmitted();
      const reason = coerceOutcomeReason(asString(params.reason), ctx.lastBlocked);
      if (!reason) return JSON.stringify({ error: "reason required" });
      if (
        reason === "out_of_scope" &&
        ((ctx.userTurns ?? 99) < 2 || ctx.knownPatient)
      ) {
        return JSON.stringify({
          error: "do_not_submit_yet",
          next_step:
            "Stay on the line. A misdial or 'wrong number' is not out_of_scope. Wait for their real request.",
        });
      }
      const result = await ctx.platform.submitNoAction({ call_id: ctx.callId, reason });
      ctx.draftBook = undefined;
      ctx.submitted = true;
      ctx.outcome = "sin_cita";
      ctx.outcomeReason = reason;
      return JSON.stringify(result);
    }
    case "submit_escalate": {
      if (ctx.submitted) return alreadySubmitted();
      let reason = coerceOutcomeReason(asString(params.reason), ctx.lastBlocked);
      if (!reason || !OUTCOME_REASONS.has(reason)) reason = "out_of_scope";
      const result = ctx.simulationMode
        ? { accepted: true, action: "ESCALATE" as const, reason, simulated: true }
        : await ctx.platform.submitEscalate({ call_id: ctx.callId, reason });
      const summary = [
        ctx.patientName ? `Paciente ${ctx.patientName}.` : null,
        `Motivo ${reason.replaceAll("_", " ")}.`,
      ]
        .filter(Boolean)
        .join(" ");
      const transfer = await transferTwilioCall(ctx.simulationMode ? undefined : ctx.twilioCallSid, summary, ctx.audit);
      ctx.draftBook = undefined;
      ctx.submitted = true;
      ctx.outcome = "escalado";
      ctx.outcomeReason = reason;
      const transferPayload = transfer.configured
        ? {
            transferred: transfer.transferred,
            originated: transfer.originated ?? false,
            ...(transfer.callSid ? { callSid: transfer.callSid } : {}),
            ...(transfer.error ? { twilio_error: transfer.error } : {}),
          }
        : { transferred: false, twilio_error: transfer.error ?? "not_configured" };
      return JSON.stringify({ ...result, transfer: transferPayload });
    }
    case "submit_register": {
      if (ctx.submitted) return alreadySubmitted();
      const insurer = asInsurer(params.insurer);
      let given_name = asString(params.given_name);
      let first_surname = asString(params.first_surname);
      let second_surname = asString(params.second_surname);
      const national_id = asString(params.national_id);
      const date_of_birth = asString(params.date_of_birth);
      const phone = asString(params.phone);
      const email = asString(params.email);
      if (given_name && !first_surname) {
        const parts = given_name.split(/\s+/);
        if (parts.length >= 2) {
          given_name = parts[0];
          first_surname = parts.slice(1).join(" ");
        }
      }
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
        return JSON.stringify({
          error: "missing register fields",
          next_step:
            "Collect name, DNI, date of birth, phone, email and insurer from the caller. Insurer id must be sanitas|adeslas|dkv|asisa|mapfre|caser|cigna|axa|nueva_mutua|privado. Never invent details.",
        });
      }
      const nid = national_id.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (
        /example\.com/i.test(email) ||
        nid === "x1234567l" ||
        (foldName(given_name) === "john" && foldName(first_surname) === "doe")
      ) {
        return JSON.stringify({
          error: "invented details",
          next_step: "Those were placeholders. Ask the caller for their real details and submit_register again.",
        });
      }
      const mail = normalizeRegisterEmail(email);
      const result = await ctx.platform.submitRegister({
          call_id: ctx.callId,
          given_name: restoreRegisterName(given_name),
          first_surname: restoreRegisterName(alignSurnameWithEmail(first_surname, mail)),
          second_surname: restoreRegisterName(second_surname),
          national_id,
          date_of_birth,
          phone: normalizeRegisterPhone(phone),
          email: mail,
          insurer,
        });
      ctx.draftBook = undefined;
      ctx.submitted = true;
      ctx.outcome = "alta";
      return JSON.stringify(result);
    }
    case "submit_cancel": {
      if (ctx.submitted) return alreadySubmitted();
      const appointment_id = asString(params.appointment_id);
      if (!appointment_id) return JSON.stringify({ error: "appointment_id required" });
      const result = await ctx.platform.submitCancel({ call_id: ctx.callId, appointment_id });
      ctx.draftBook = undefined;
      ctx.submitted = true;
      ctx.outcome = "cancelacion";
      return JSON.stringify(result);
    }
    case "submit_reschedule": {
      if (ctx.submitted) return alreadySubmitted();
      const policy = asInsurer(params.policy_id);
      const appointment_id = asString(params.appointment_id);
      const provider_id = asString(params.provider_id);
      const location_id = asLocation(params.location_id);
      const slot = asString(params.slot);
      if (!policy || !appointment_id || !provider_id || !location_id || !slot) {
        return JSON.stringify({ error: "missing reschedule fields" });
      }
      const result = await ctx.platform.submitReschedule({
          call_id: ctx.callId,
          appointment_id,
          provider_id: asProviderId(provider_id) ?? provider_id,
          location_id,
          slot,
          policy_id: policy,
        });
      ctx.draftBook = undefined;
      ctx.submitted = true;
      ctx.outcome = "cambio";
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `unknown tool ${name}` });
  }
}
