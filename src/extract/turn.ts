import { generateText, Output } from "ai";
import { z } from "zod";
import {
  inferInsurer,
  inferLocation,
  inferProviderName,
  inferSpecialty,
  inferTimePreference,
  inferWeekday,
  isEmergency,
  isExplicitAcceptance,
  isExplicitRejection,
} from "../playbook/rules";
import { resolveWhenExactly } from "../playbook/calendar";
import { resolveAddressCoordinates } from "../playbook/geography";
import { classifyTriage } from "../playbook/triage";
import { isOutOfScope } from "../security/privacy";
import type { CallState, CallerConstraints } from "../state/call-state";

const nullableText = z.string().nullable();
const EXTRACTOR_MODEL =
  process.env.EXTRACTOR_MODEL ?? "openai/gpt-5.4-mini-fast";

const extractionSchema = z.object({
  intent: z
    .enum(["book", "register", "reschedule", "cancel", "no_action", "escalate"])
    .nullable(),
  specialtyId: z
    .enum([
      "general_practice",
      "orthopaedics",
      "paediatrics",
      "dermatology",
      "gynaecology",
      "physiotherapy",
    ])
    .nullable(),
  providerName: nullableText,
  locationId: z.enum(["centro", "norte", "sur"]).nullable(),
  weekday: z.number().int().min(0).max(6).nullable(),
  dateFrom: nullableText,
  dateTo: nullableText,
  timePreference: z.enum(["morning", "afternoon", "any"]).nullable(),
  language: z.enum(["en", "es", "ca"]).nullable(),
  providerLanguage: z.enum(["en", "es", "ca"]).nullable(),
  insurer: z
    .enum([
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
    ])
    .nullable(),
  acceptance: z.enum(["accepted", "rejected", "unknown"]),
  correction: z.boolean(),
  clearConstraints: z.array(
    z.enum([
      "providerName",
      "providerId",
      "locationId",
      "weekday",
      "dateFrom",
      "dateTo",
      "timePreference",
    ]),
  ),
  appointmentDate: nullableText,
  allAppointments: z.boolean(),
  acceptanceTarget: z
    .enum(["appointment_offer", "fallback", "registration", "cancellation", "policy", "unknown"])
    .optional(),
  bookingSubject: z.enum(["caller", "third_party", "unknown"]).optional(),
  relation: nullableText.optional(),
  callerIdentity: z
    .object({
      name: nullableText,
      nationalId: nullableText,
      phone: nullableText,
      dateOfBirth: nullableText,
    })
    .optional(),
  patientIdentity: z
    .object({
      name: nullableText,
      nationalId: nullableText,
      phone: nullableText,
      dateOfBirth: nullableText,
    })
    .optional(),
  symptomText: nullableText.optional(),
  originAddress: nullableText.optional(),
  clinicQuestion: nullableText.optional(),
  temporalExpression: nullableText.optional(),
  alternativePolicy: z
    .enum([
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
    ])
    .nullable()
    .optional(),
  appointmentSelector: z
    .object({
      date: nullableText,
      time: nullableText,
      providerName: nullableText,
      locationId: z.enum(["centro", "norte", "sur"]).nullable(),
    })
    .optional(),
  identity: z.object({
    name: nullableText,
    nationalId: nullableText,
    phone: nullableText,
    dateOfBirth: nullableText,
  }),
  registration: z.object({
    given_name: nullableText,
    first_surname: nullableText,
    second_surname: nullableText,
    national_id: nullableText,
    date_of_birth: nullableText,
    phone: nullableText,
    email: nullableText,
    insurer: nullableText,
  }),
});

export type TurnExtraction = z.infer<typeof extractionSchema>;

function fallbackExtraction(text: string): TurnExtraction {
  const specialtyId = (inferSpecialty(text) ?? null) as TurnExtraction["specialtyId"];
  const locationId = (inferLocation(text) ?? null) as TurnExtraction["locationId"];
  const weekday = inferWeekday(text) ?? null;
  const timePreference = inferTimePreference(text) ?? null;
  const insurer = inferInsurer(text) ?? null;
  const providerName = inferProviderName(text) ?? null;
  const nationalId = text.match(/\b(?:[XYZ]\s*[- ]?\s*\d{7}|\d{8})\s*[- ]?\s*[A-Z]\b/i)?.[0] ?? null;
  const phone = text.match(/(?:\+?34|0034)?[\s-]*[6789](?:[\s-]*\d){8}\b/)?.[0] ?? null;
  const dateOfBirth = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
  const accepted = isExplicitAcceptance(text);
  const rejected = isExplicitRejection(text);
  const intent: TurnExtraction["intent"] = isEmergency(text)
    ? "escalate"
    : /\b(cancel|cancelar|anular)\b/i.test(text)
      ? "cancel"
      : /\b(reschedul|move|change|cambiar|mover)\b/i.test(text)
        ? "reschedule"
        : /\b(register|alta|new patient)\b/i.test(text)
          ? "register"
          : specialtyId
            ? "book"
            : null;
  return {
    intent,
    specialtyId,
    providerName,
    locationId,
    weekday,
    dateFrom: null,
    dateTo: null,
    timePreference,
    language: null,
    providerLanguage: null,
    insurer: insurer as TurnExtraction["insurer"],
    acceptance: accepted ? "accepted" : rejected ? "rejected" : "unknown",
    correction: /\b(actually|instead|correction|rather|en realidad|mejor|perdon)\b/i.test(text),
    clearConstraints: [],
    appointmentDate: null,
    allAppointments: /\b(both|all|las dos|ambas|todas)\b/i.test(text),
    acceptanceTarget: "unknown",
    bookingSubject: /\b(?:for|por)\s+(?:my|mi|the|la|el)\s+(?:son|daughter|father|mother|child|hijo|hija|padre|madre)\b/i.test(text)
      ? "third_party"
      : "unknown",
    symptomText: null,
    originAddress: null,
    clinicQuestion: null,
    temporalExpression: null,
    alternativePolicy: null,
    identity: { name: null, nationalId, phone, dateOfBirth },
    registration: {
      given_name: null,
      first_surname: null,
      second_surname: null,
      national_id: nationalId,
      date_of_birth: dateOfBirth,
      phone,
      email: text.match(/\b[\w.+-]+\s*@\s*[\w.-]+\.[A-Za-z]{2,}\b/)?.[0] ?? null,
      insurer,
    },
  };
}

export async function extractTurn(text: string, state: CallState): Promise<TurnExtraction> {
  const deterministic = fallbackExtraction(text);
  if (isOutOfScope(text)) {
    return { ...deterministic, intent: "no_action" };
  }
  const triage = classifyTriage([...state.symptomHistory, text]);
  if (triage === "medical_emergency") {
    return { ...deterministic, intent: "escalate", symptomText: text };
  }

  const enrich = (extraction: TurnExtraction): TurnExtraction => {
    const when = resolveWhenExactly(text, state.referenceTime);
    const inferredTriage = classifyTriage([...state.symptomHistory, text]);
    return {
      ...extraction,
      intent:
        inferredTriage === "medical_emergency"
          ? "escalate"
          : extraction.intent,
      specialtyId:
        inferredTriage && inferredTriage !== "medical_emergency"
          ? inferredTriage
          : extraction.specialtyId,
      dateFrom: when?.dateFrom ?? extraction.dateFrom,
      dateTo: when?.dateTo ?? extraction.dateTo,
      timePreference: when?.timePreference ?? extraction.timePreference,
      temporalExpression: when ? text : extraction.temporalExpression,
      symptomText: inferredTriage ? text : extraction.symptomText,
      originAddress:
        resolveAddressCoordinates(text) !== undefined
          ? text
          : extraction.originAddress,
    };
  };

  try {
    const result = await generateText({
      model: EXTRACTOR_MODEL,
      output: Output.object({ schema: extractionSchema }),
      prompt: `Extract only facts explicitly stated or corrected in the caller's latest utterance.
Do not carry absent values from prior turns and do not guess.
Weekday uses 0=Sunday, 1=Monday ... 6=Saturday.
Intent describes the requested terminal action. A symptom requesting a visit is book.
language is the language spoken in this utterance. providerLanguage is only set when the
caller explicitly requires a clinician who speaks that language.
Mark correction=true when a new value replaces a previous preference.
When the caller explicitly says an earlier preference no longer matters, include its
field in clearConstraints. appointmentDate is the date of an existing appointment
they want to cancel or move, not a requested new date.
Do not calculate relative dates. Put the caller's exact relative date phrase in
temporalExpression and leave dateFrom/dateTo null unless an absolute date was stated.
Separate callerIdentity from patientIdentity whenever somebody calls for another person.
bookingSubject is third_party in that situation. relation is only the explicitly stated
relationship. symptomText contains the caller's symptom wording without diagnosing it.
clinicQuestion contains factual questions about sites, providers, specialties or hours.
originAddress is the caller's street/address, never a clinic name. alternativePolicy is
only an explicitly declared second insurance plan. acceptanceTarget identifies what the
caller is accepting; use unknown if the utterance does not make that unambiguous.
Current state: ${JSON.stringify({
        intent: state.intent,
        constraints: state.constraints,
        phase: state.phase,
        hasOffer: Boolean(state.offer),
        pendingDecision: state.pendingDecision,
        bookingSubject: state.bookingSubject,
        referenceTime: state.referenceTime,
      })}
Latest caller utterance: ${JSON.stringify(text)}`,
    });
    return enrich(result.output);
  } catch {
    return enrich(deterministic);
  }
}

function changed<T extends keyof CallerConstraints>(
  constraints: CallerConstraints,
  key: T,
  value: CallerConstraints[T] | null,
) {
  if (value == null || constraints[key] === value) return false;
  constraints[key] = value;
  return true;
}

export function applyTurnExtraction(
  state: CallState,
  text: string,
  extraction: TurnExtraction,
) {
  state.turn += 1;
  state.lastUserText = text;
  if (extraction.intent) state.intent = extraction.intent;
  if (isEmergency(text)) state.intent = "escalate";

  let constraintsChanged = false;
  for (const key of extraction.clearConstraints) {
    if (state.constraints[key] !== undefined) {
      delete state.constraints[key];
      constraintsChanged = true;
    }
  }
  constraintsChanged = changed(state.constraints, "specialtyId", extraction.specialtyId) || constraintsChanged;
  constraintsChanged = changed(state.constraints, "providerName", extraction.providerName) || constraintsChanged;
  constraintsChanged = changed(state.constraints, "locationId", extraction.locationId) || constraintsChanged;
  constraintsChanged = changed(state.constraints, "weekday", extraction.weekday) || constraintsChanged;
  constraintsChanged = changed(state.constraints, "dateFrom", extraction.dateFrom) || constraintsChanged;
  constraintsChanged = changed(state.constraints, "dateTo", extraction.dateTo) || constraintsChanged;
  constraintsChanged = changed(state.constraints, "timePreference", extraction.timePreference) || constraintsChanged;
  constraintsChanged =
    changed(state.constraints, "providerLanguage", extraction.providerLanguage) ||
    constraintsChanged;
  constraintsChanged = changed(state.constraints, "insurer", extraction.insurer) || constraintsChanged;
  if (extraction.language) state.conversationLanguage = extraction.language;

  if (constraintsChanged || extraction.correction) {
    state.constraintsVersion += 1;
    state.offer = undefined;
    if (state.phase === "offer" || state.phase === "confirm") state.phase = "search";
  }

  if (extraction.bookingSubject && extraction.bookingSubject !== "unknown") {
    state.bookingSubject = extraction.bookingSubject;
  }
  if (extraction.relation) state.relation = extraction.relation;
  if (extraction.symptomText) state.symptomHistory.push(extraction.symptomText);
  if (extraction.originAddress) state.originAddress = extraction.originAddress;
  if (extraction.clinicQuestion) state.clinicQuestion = extraction.clinicQuestion;
  if (extraction.alternativePolicy) {
    if (!state.declaredAlternativePolicies.includes(extraction.alternativePolicy)) {
      state.declaredAlternativePolicies.push(extraction.alternativePolicy);
    }
    state.activePolicy = extraction.alternativePolicy;
    state.constraints.insurer = extraction.alternativePolicy;
    state.policyRecoveryStatus = "retrying";
  }
  if (extraction.appointmentSelector) {
    const selector = Object.fromEntries(
      Object.entries(extraction.appointmentSelector).filter(([, value]) => value != null),
    );
    if (Object.keys(selector).length) state.appointmentSelectors.push(selector);
  }

  for (const [key, value] of Object.entries(extraction.registration)) {
    if (value) state.registration[key as keyof typeof state.registration] = value;
  }
  const callerIdentity = extraction.callerIdentity;
  const patientIdentity = extraction.patientIdentity;
  for (const [key, value] of Object.entries(callerIdentity ?? {})) {
    if (value) state.callerIdentity[key as keyof typeof state.callerIdentity] = value;
  }
  let patientIdentityChanged = false;
  for (const [key, value] of Object.entries(patientIdentity ?? extraction.identity)) {
    if (!value) continue;
    const identityKey = key as keyof typeof state.patientIdentity;
    patientIdentityChanged =
      state.patientIdentity[identityKey] !== undefined &&
      state.patientIdentity[identityKey] !== value
        ? true
        : patientIdentityChanged;
    state.patientIdentity[identityKey] = value;
    state.identity[identityKey] = value;
  }
  if (state.bookingSubject !== "third_party") {
    for (const [key, value] of Object.entries(extraction.identity)) {
      if (!value) continue;
      const identityKey = key as keyof typeof state.callerIdentity;
      state.callerIdentity[identityKey] = value;
    }
  }
  if (patientIdentityChanged) {
    state.identityVersion += 1;
    state.resolvedPatientId = undefined;
    state.resolvedIdentityVersion = undefined;
    state.knownPatients = [];
    state.listedAppointments = [];
    state.targetAppointmentId = undefined;
    state.targetAppointmentIds = [];
    state.lastAvailability = undefined;
    state.offer = undefined;
    state.primaryPolicy = undefined;
    state.activePolicy = undefined;
  }

  if (extraction.acceptance === "accepted" && extraction.acceptanceTarget === "registration") {
    state.registrationConfirmed = true;
  }

  if (extraction.intent && state.workItems.length === 0) {
    const id = `work-${state.turn}`;
    state.workItems.push({
      id,
      subjectKey: state.bookingSubject === "third_party" ? "patient" : "caller",
      intent: extraction.intent,
      status: "active",
      constraints: { ...state.constraints },
      targetAppointmentIds: [],
      createdAtTurn: state.turn,
    });
    state.activeWorkItemId = id;
  }

  return extraction.acceptance;
}
