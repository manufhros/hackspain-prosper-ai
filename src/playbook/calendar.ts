import type { TimePreference } from "../state/call-state";

export const MADRID_TIME_ZONE = "Europe/Madrid";

export type ClinicLocation = "centro" | "norte" | "sur";
export type IsoDate = `${number}-${number}-${number}`;

export type ResolvedWhen = {
  dateFrom: IsoDate;
  dateTo: IsoDate;
  timePreference: TimePreference;
};

const WEEKDAYS: ReadonlyArray<readonly [number, string]> = [
  [0, "sunday"],
  [1, "monday"],
  [2, "tuesday"],
  [3, "wednesday"],
  [4, "thursday"],
  [5, "friday"],
  [6, "saturday"],
];

const WEEKDAY_PATTERN =
  "(sunday|monday|tuesday|wednesday|thursday|friday|saturday)";

function assertIsoDate(value: string): asserts value is IsoDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid ISO date: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
    .toISOString()
    .slice(0, 10);
  if (roundTrip !== value) throw new RangeError(`Invalid ISO date: ${value}`);
}

function madridDate(referenceTime: string | Date): IsoDate {
  const date = new Date(referenceTime);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid reference time: ${String(referenceTime)}`);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = `${parts.find((part) => part.type === "year")?.value}-${
    parts.find((part) => part.type === "month")?.value
  }-${parts.find((part) => part.type === "day")?.value}`;
  assertIsoDate(value);
  return value;
}

function shiftDate(value: IsoDate, days: number): IsoDate {
  assertIsoDate(value);
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days))
    .toISOString()
    .slice(0, 10) as IsoDate;
}

function weekday(value: IsoDate): number {
  assertIsoDate(value);
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

function nextWeekday(value: IsoDate, targetWeekday: number): IsoDate {
  const delta = (targetWeekday - weekday(value) + 7) % 7 || 7;
  return shiftDate(value, delta);
}

function weekdayNumber(name: string): number {
  const result = WEEKDAYS.find(([, weekdayName]) => weekdayName === name)?.[0];
  if (result == null) throw new RangeError(`Unknown weekday: ${name}`);
  return result;
}

function resolved(
  date: IsoDate,
  timePreference: TimePreference = "any",
): ResolvedWhen {
  return { dateFrom: date, dateTo: date, timePreference };
}

/**
 * Resolves only the official "When Exactly" vocabulary. It deliberately does
 * not guess dates from free-form text, so callers can fall back to clarification.
 */
export function resolveWhenExactly(
  text: string,
  referenceTime: string | Date,
): ResolvedWhen | undefined {
  const value = text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  const today = madridDate(referenceTime);

  if (/\bfirst thing on monday the twelfth of october\b/.test(value)) {
    const year = Number(today.slice(0, 4));
    const thisYear = `${year}-10-12` as IsoDate;
    return resolved(
      thisYear < today ? (`${year + 1}-10-12` as IsoDate) : thisYear,
      "morning",
    );
  }

  if (/\bday after tomorrow\b/.test(value)) {
    return resolved(shiftDate(today, 2));
  }
  if (/\btomorrow\b/.test(value)) {
    return resolved(shiftDate(today, 1));
  }
  if (/\ba week from today\b/.test(value)) {
    return resolved(shiftDate(today, 7));
  }
  if (/\bin a fortnight\b/.test(value)) {
    return resolved(shiftDate(today, 14));
  }

  const saturdayMorning = /\bon saturday morning\b/.exec(value);
  if (saturdayMorning) {
    return resolved(nextWeekday(today, 6), "morning");
  }

  const coming = new RegExp(`\\bthis coming ${WEEKDAY_PATTERN}\\b`).exec(value);
  if (coming?.[1]) {
    return resolved(nextWeekday(today, weekdayNumber(coming[1])));
  }

  const firstThing = new RegExp(
    `\\bfirst thing(?: on)? ${WEEKDAY_PATTERN}\\b`,
  ).exec(value);
  if (firstThing?.[1]) {
    return resolved(nextWeekday(today, weekdayNumber(firstThing[1])), "morning");
  }

  const afternoon = new RegExp(`\\b(?:on )?${WEEKDAY_PATTERN} afternoon\\b`).exec(
    value,
  );
  if (afternoon?.[1]) {
    return resolved(nextWeekday(today, weekdayNumber(afternoon[1])), "afternoon");
  }

  return undefined;
}

function assertLocation(location: ClinicLocation | undefined) {
  if (
    location !== undefined &&
    location !== "centro" &&
    location !== "norte" &&
    location !== "sur"
  ) {
    throw new RangeError(`Unknown clinic location: ${location}`);
  }
}

function assertTimePreference(timePreference: TimePreference) {
  if (
    timePreference !== "morning" &&
    timePreference !== "afternoon" &&
    timePreference !== "any"
  ) {
    throw new RangeError(`Unknown time preference: ${timePreference}`);
  }
}

/**
 * Reports whether the requested site/time band has any opening on the date.
 * With no site, it reports whether any clinic in the network is open.
 */
export function isOpenDay(
  date: string,
  location?: ClinicLocation,
  timePreference: TimePreference = "any",
): boolean {
  assertIsoDate(date);
  assertLocation(location);
  assertTimePreference(timePreference);

  const day = weekday(date);
  if (date.slice(5) === "10-12" || day === 0) return false;
  if (day === 6) return location === undefined || location === "centro";
  if (location === "sur" && day === 5 && timePreference === "afternoon") {
    return false;
  }
  return true;
}

/**
 * Finds the first strictly later open date, applying the same site and time
 * preference to every candidate.
 */
export function nextOpenDay(
  date: string,
  location?: ClinicLocation,
  timePreference: TimePreference = "any",
): IsoDate {
  assertIsoDate(date);
  assertLocation(location);
  assertTimePreference(timePreference);

  let candidate = shiftDate(date, 1);
  while (!isOpenDay(candidate, location, timePreference)) {
    candidate = shiftDate(candidate, 1);
  }
  return candidate;
}
