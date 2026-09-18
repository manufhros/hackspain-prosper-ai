import type {
  AvailabilitySlot,
  CallerConstraints,
  TimePreference,
} from "../state/call-state";

export const OUTCOME_REASONS = [
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
] as const;

export const INSURERS = [
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
] as const;

export type OutcomeReason = (typeof OUTCOME_REASONS)[number];
export type Insurer = (typeof INSURERS)[number];

export function fold(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function madridYmd(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shiftYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function earliestBookableDay(referenceTime: string | Date = new Date()) {
  return shiftYmd(madridYmd(new Date(referenceTime)), 1);
}

export function windowEnd(dateFrom: string, days = 13) {
  return shiftYmd(dateFrom, days);
}

export function inferSpecialty(text: string): string | undefined {
  const value = fold(text);
  if (/\b(gp|general practice|family doctor|medico de cabecera|medicina general)\b/.test(value)) {
    return "general_practice";
  }
  if (/\b(orthopaed|orthoped|traumatolog|ankle|shoulder|knee|wrist|lower back)\b/.test(value)) {
    return "orthopaedics";
  }
  if (/\b(paediatric|pediatric|pediatr|child|nino|nina)\b/.test(value)) return "paediatrics";
  if (/\b(dermatolog|skin|piel|mole)\b/.test(value)) return "dermatology";
  if (/\b(gynaecolog|gynecolog|ginecolog|period|menstrual)\b/.test(value)) return "gynaecology";
  if (/\b(physio|fisioterap)\b/.test(value)) return "physiotherapy";
  return undefined;
}

export function inferLocation(text: string): string | undefined {
  const value = fold(text);
  if (/\b(arenal )?centro\b/.test(value)) return "centro";
  if (/\b(arenal )?norte\b/.test(value)) return "norte";
  if (/\b(arenal )?sur\b/.test(value)) return "sur";
  return undefined;
}

export function inferTimePreference(text: string): TimePreference | undefined {
  const value = fold(text);
  if (/\b(morning|manana|mati|first thing)\b/.test(value)) return "morning";
  if (/\b(afternoon|tarde)\b/.test(value)) return "afternoon";
  return undefined;
}

const WEEKDAYS: Array<[number, RegExp]> = [
  [1, /\b(monday|lunes|dilluns)\b/],
  [2, /\b(tuesday|martes|dimarts)\b/],
  [3, /\b(wednesday|miercoles|dimecres)\b/],
  [4, /\b(thursday|jueves|dijous)\b/],
  [5, /\b(friday|viernes|divendres)\b/],
  [6, /\b(saturday|sabado|dissabte)\b/],
  [0, /\b(sunday|domingo|diumenge)\b/],
];

export function inferWeekday(text: string): number | undefined {
  const value = fold(text);
  return WEEKDAYS.find(([, pattern]) => pattern.test(value))?.[0];
}

export function inferInsurer(text: string): string | undefined {
  const value = fold(text).replace(/\s+/g, "_");
  return INSURERS.find((insurer) => value.includes(insurer));
}

export function inferProviderName(text: string): string | undefined {
  const match = text.match(
    /\b(?:Dr\.?|Dra\.?|Doctor(?:a)?|D\.)\s+([A-ZÁÉÍÓÚÑÀÈÌÒÙÇ][\p{L}'’-]+(?:\s+[A-ZÁÉÍÓÚÑÀÈÌÒÙÇ][\p{L}'’-]+){0,2})/u,
  );
  return match?.[0]?.trim();
}

export function isExplicitAcceptance(text: string) {
  const value = fold(text);
  if (/\b(no|not|don't|doesn't|do not|pero no|not really)\b/.test(value)) return false;
  return /\b(yes|yeah|yep|sure|that works|book it|please do|go ahead|si|vale|de acuerdo|perfecto|confirmo|d'acord|endavant|em va be|ok|okay)\b/.test(
    value,
  );
}

export function isExplicitRejection(text: string) {
  const value = fold(text);
  return /\b(no|doesn't work|does not work|another|different|otro|otra|no me va bien|no em va be)\b/.test(
    value,
  );
}

export function isEmergency(text: string) {
  const value = fold(text);
  return [
    /chest.*(tight|pain).*(breath|breathe)/,
    /(face.*droop|arm.*weak|speech.*slur)/,
    /(cannot|can't).*(breath|breathe)/,
    /bleed.*(heavy|won't stop|will not stop)/,
    /head.*(bang|hit).*(confus|vomit|sick)/,
  ].some((pattern) => pattern.test(value));
}

export function slotMatches(slot: AvailabilitySlot, constraints: CallerConstraints) {
  if (constraints.specialtyId && slot.specialty_id !== constraints.specialtyId) return false;
  if (constraints.providerId && slot.provider_id !== constraints.providerId) return false;
  if (constraints.locationId && slot.location_id !== constraints.locationId) return false;
  if (constraints.providerLanguage && constraints.providerLanguage !== "any") {
    // Provider-language filtering is done before this point using provider metadata.
  }
  const date = new Date(slot.start_time);
  const madridParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekdayName = madridParts.find((part) => part.type === "weekday")?.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekdayName ?? "",
  );
  const hour = Number(madridParts.find((part) => part.type === "hour")?.value ?? "0");
  if (constraints.weekday != null && weekday !== constraints.weekday) return false;
  if (constraints.timePreference === "morning" && hour >= 14) return false;
  if (constraints.timePreference === "afternoon" && hour < 14) return false;
  return true;
}

export function selectEarliestSlot(
  slots: AvailabilitySlot[],
  constraints: CallerConstraints,
  providerLanguages: Map<string, string[]> = new Map(),
) {
  return slots
    .filter((slot) => {
      if (!slotMatches(slot, constraints)) return false;
      if (
        constraints.providerLanguage &&
        constraints.providerLanguage !== "any" &&
        !providerLanguages.get(slot.provider_id)?.includes(constraints.providerLanguage)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))[0];
}
