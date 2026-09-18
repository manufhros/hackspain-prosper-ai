import type { TurnExtraction } from "../../extract/turn";

export type ScriptedTurn = {
  text: string;
  extraction: TurnExtraction;
};

export type ScriptedFixture = {
  caseId: string;
  fromNumber: string;
  turns: ScriptedTurn[];
};

export function extracted(
  values: Partial<Omit<TurnExtraction, "identity">> & {
    identity?: Partial<TurnExtraction["identity"]>;
  } = {},
): TurnExtraction {
  const { identity, ...rest } = values;
  return {
    intent: null,
    specialtyId: null,
    providerName: null,
    locationId: null,
    weekday: null,
    dateFrom: null,
    dateTo: null,
    timePreference: null,
    language: "en",
    providerLanguage: null,
    insurer: null,
    acceptance: "unknown",
    correction: false,
    clearConstraints: [],
    appointmentDate: null,
    allAppointments: false,
    identity: {
      name: null,
      nationalId: null,
      phone: null,
      dateOfBirth: null,
      ...identity,
    },
    registration: {
      given_name: null,
      first_surname: null,
      second_surname: null,
      national_id: null,
      date_of_birth: null,
      phone: null,
      email: null,
      insurer: null,
    },
    ...rest,
  };
}

function booking(
  caseId: string,
  fromNumber: string,
  name: string,
  specialtyId: NonNullable<TurnExtraction["specialtyId"]>,
  preferences: Pick<
    TurnExtraction,
    "locationId" | "weekday" | "timePreference"
  > = { locationId: null, weekday: null, timePreference: null },
): ScriptedFixture {
  return {
    caseId,
    fromNumber,
    turns: [
      {
        text: `Hello, I am ${name}. I need the earliest ${specialtyId} appointment.`,
        extraction: extracted({
          intent: "book",
          specialtyId,
          identity: { name },
        }),
      },
      {
        text:
          preferences.locationId || preferences.weekday != null || preferences.timePreference
            ? "I have those clinic, day, and time preferences."
            : "No preference, just the earliest appointment.",
        extraction: extracted(preferences),
      },
      {
        text: "Yes, that works for me.",
        extraction: extracted({ acceptance: "accepted" }),
      },
    ],
  };
}

export const SIMPLE_BOOKING_FIXTURES: ScriptedFixture[] = [
  booking(
    "simple_booking-14a8720daa02",
    "+34711330529",
    "Josefa Domínguez Navarro",
    "general_practice",
  ),
  booking(
    "simple_booking-12dc84a98cb2",
    "+34712676131",
    "Amelia Hughes White",
    "general_practice",
    { locationId: "centro", weekday: null, timePreference: null },
  ),
  booking(
    "simple_booking-3371b9ac9462",
    "+34731169716",
    "Ignacio Vázquez Moreno",
    "orthopaedics",
  ),
  booking(
    "simple_booking-b33e7e633856",
    "+34708729566",
    "Chloe Roberts Smith",
    "general_practice",
    { locationId: "sur", weekday: 1, timePreference: "morning" },
  ),
];
