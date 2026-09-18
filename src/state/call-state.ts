export type Phase =
  | "greeted"
  | "intake"
  | "identify"
  | "search"
  | "offer"
  | "confirm"
  | "submit"
  | "closed";

export type Intent =
  | "book"
  | "register"
  | "reschedule"
  | "cancel"
  | "no_action"
  | "escalate"
  | "unknown";

export type TimePreference = "morning" | "afternoon" | "any";
export type ConversationLanguage = "en" | "es" | "ca";
export type BookingSubject = "caller" | "third_party" | "unknown";
export type LocationId = "centro" | "norte" | "sur";

export type IdentityDraft = {
  name?: string;
  nationalId?: string;
  phone?: string;
  dateOfBirth?: string;
};

export type CallerConstraints = {
  specialtyId?: string;
  providerId?: string;
  providerName?: string;
  locationId?: LocationId;
  weekday?: number;
  dateFrom?: string;
  dateTo?: string;
  timePreference?: TimePreference;
  providerLanguage?: string;
  insurer?: string;
};

export type PatientMatch = {
  patient_id: string;
  given_name: string;
  first_surname: string;
  second_surname: string;
  national_id: string;
  date_of_birth: string;
  phone: string;
  has_visited_before: boolean;
  insurer: string;
  referrals: string[];
  note: string;
  match_score: number;
  matched_fields: string[];
};

export type AvailabilitySlot = {
  provider_id: string;
  provider_name: string;
  specialty_id: string;
  location_id: LocationId;
  appointment_type_id: string;
  start_time: string;
  duration_minutes: number;
  payable_with: string[];
};

export type Appointment = {
  appointment_id: string;
  patient_id: string;
  provider_id: string;
  location_id: LocationId;
  appointment_type_id: string;
  start_time: string;
  duration_minutes: number;
};

export type AppointmentSelector = {
  date?: string;
  time?: string;
  providerName?: string;
  locationId?: string;
};

export type PendingDecision =
  | "appointment_offer"
  | "provider_fallback"
  | "date_fallback"
  | "specialty_redirect"
  | "policy_fallback"
  | "registration_confirmation"
  | "cancellation_confirmation";

export type WorkItem = {
  id: string;
  subjectKey: "caller" | "patient";
  intent: Exclude<Intent, "unknown">;
  status: "pending" | "active" | "offered" | "submitted" | "declined";
  constraints: CallerConstraints;
  targetAppointmentIds: string[];
  createdAtTurn: number;
};

export type OfferState = {
  patientId: string;
  providerId: string;
  providerName: string;
  locationId: string;
  appointmentTypeId: string;
  slot: string;
  policyId: string;
  offeredAtTurn: number;
  constraintsVersion: number;
};

export type SubmissionRecord = {
  action: "BOOK" | "REGISTER" | "RESCHEDULE" | "CANCEL" | "NO_ACTION" | "ESCALATE";
  payload: Record<string, unknown>;
  turn: number;
  dryRun: boolean;
};

export type RegistrationDraft = {
  given_name?: string;
  first_surname?: string;
  second_surname?: string;
  national_id?: string;
  date_of_birth?: string;
  phone?: string;
  email?: string;
  insurer?: string;
};

export type CallState = {
  callId: string;
  fromNumber: string | null;
  referenceTime: string;
  turn: number;
  phase: Phase;
  intent: Intent;
  conversationLanguage: ConversationLanguage;
  constraints: CallerConstraints;
  constraintsVersion: number;
  identity: IdentityDraft;
  callerIdentity: IdentityDraft;
  patientIdentity: IdentityDraft;
  bookingSubject: BookingSubject;
  relation?: string;
  identityVersion: number;
  resolvedIdentityVersion?: number;
  workItems: WorkItem[];
  activeWorkItemId?: string;
  preferencesAsked: boolean;
  allowProviderFallback: boolean;
  providerLookupAttempts: number;
  knownPatients: PatientMatch[];
  resolvedPatientId?: string;
  lastAvailability?: {
    patientId: string;
    slots: AvailabilitySlot[];
    blocked: Array<{ provider_id: string; restriction: string }>;
    searchedAtTurn: number;
    constraintsVersion: number;
  };
  offer?: OfferState;
  pendingDecision?: PendingDecision;
  rejectedSlots: string[];
  listedAppointments: Appointment[];
  targetAppointmentId?: string;
  targetAppointmentIds: string[];
  appointmentSelectors: AppointmentSelector[];
  replacementNotBefore?: string;
  registration: RegistrationDraft;
  registrationConfirmed: boolean;
  primaryPolicy?: string;
  declaredAlternativePolicies: string[];
  activePolicy?: string;
  policyRecoveryStatus: "idle" | "offered" | "awaiting_name" | "retrying";
  symptomHistory: string[];
  originAddress?: string;
  clinicQuestion?: string;
  submissions: SubmissionRecord[];
  lastUserText?: string;
  violations: string[];
};

export function createCallState(
  callId = "",
  fromNumber: string | null = null,
  referenceTime = new Date().toISOString(),
): CallState {
  return {
    callId,
    fromNumber,
    referenceTime,
    turn: 0,
    phase: "greeted",
    intent: "unknown",
    conversationLanguage: "en",
    constraints: {},
    constraintsVersion: 0,
    identity: {},
    callerIdentity: {},
    patientIdentity: {},
    bookingSubject: "unknown",
    identityVersion: 0,
    workItems: [],
    preferencesAsked: false,
    allowProviderFallback: false,
    providerLookupAttempts: 0,
    knownPatients: [],
    rejectedSlots: [],
    listedAppointments: [],
    targetAppointmentIds: [],
    appointmentSelectors: [],
    registration: {},
    registrationConfirmed: false,
    declaredAlternativePolicies: [],
    policyRecoveryStatus: "idle",
    symptomHistory: [],
    submissions: [],
    violations: [],
  };
}

export function publicState(state: CallState) {
  return {
    callId: state.callId,
    referenceTime: state.referenceTime,
    turn: state.turn,
    phase: state.phase,
    intent: state.intent,
    conversationLanguage: state.conversationLanguage,
    constraints: state.constraints,
    constraintsVersion: state.constraintsVersion,
    bookingSubject: state.bookingSubject,
    activeWorkItemId: state.activeWorkItemId,
    workItems: state.workItems,
    resolvedPatientId: state.resolvedPatientId,
    knownPatientIds: state.knownPatients.map((patient) => patient.patient_id),
    offer: state.offer,
    pendingDecision: state.pendingDecision,
    activePolicy: state.activePolicy,
    policyRecoveryStatus: state.policyRecoveryStatus,
    submissions: state.submissions,
    violations: state.violations,
  };
}
