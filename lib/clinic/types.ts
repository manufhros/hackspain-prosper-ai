export type Insurer =
  | "sanitas"
  | "adeslas"
  | "dkv"
  | "asisa"
  | "mapfre"
  | "caser"
  | "cigna"
  | "axa"
  | "nueva_mutua"
  | "privado"
  | (string & {});

export type OutcomeReason =
  | "not_eligible_age"
  | "referral_required"
  | "provider_not_in_network"
  | "specialty_not_covered"
  | "location_not_covered"
  | "insurer_referral_required"
  | "allowance_exhausted"
  | "provider_on_leave"
  | "location_hours"
  | "type_not_offered"
  | "patient_history"
  | "no_availability"
  | "clinic_closed"
  | "patient_not_found"
  | "provider_not_found"
  | "caller_not_authorised"
  | "out_of_scope"
  | "medical_emergency";

export type AppointmentWindow = "upcoming" | "past" | "all";

export type ClinicCatalog = {
  clinic_name: string;
  patient_count?: number;
  calendar?: Record<string, unknown>;
  restrictions?: Array<{ id: string; title: string; explanation: string }>;
  providers: unknown[];
  specialties: unknown[];
  appointment_types: unknown[];
  locations: unknown[];
  plans: unknown[];
};

export type PatientMatch = {
  patient_id: string;
  given_name: string;
  first_surname: string;
  second_surname: string;
  national_id: string;
  date_of_birth: string;
  phone: string;
  sex?: string;
  has_visited_before?: boolean;
  insurer?: string;
  referrals?: string[];
  note?: string;
  match_score?: number;
  matched_fields?: string[];
};

export type DirectoryQuery = {
  name?: string;
  national_id?: string;
  phone?: string;
  date_of_birth?: string;
};

export type DirectoryResponse = { matches: PatientMatch[] };

export type Appointment = {
  appointment_id: string;
  patient_id: string;
  provider_id: string;
  location_id: string;
  appointment_type_id: string;
  start_time: string;
  duration_minutes?: number;
};

export type AvailabilitySlot = {
  provider_id: string;
  provider_name?: string;
  specialty_id?: string;
  location_id: string;
  appointment_type_id: string;
  start_time: string;
  duration_minutes?: number;
  payable_with?: string[];
};

export type AvailabilityQuery = {
  date_from: string;
  date_to: string;
  provider_id?: string;
  specialty_id?: string;
  location_id?: string;
  patient_id?: string;
  insurer?: string[];
};

export type AvailabilityResponse = {
  providers?: unknown[];
  appointment_type?: { id: string; name?: string };
  slots: AvailabilitySlot[];
  blocked?: Array<{ provider_id: string; restriction: string }>;
};

export type BookRequest = {
  call_id: string;
  patient_id: string;
  provider_id: string;
  location_id: string;
  appointment_type_id: string;
  slot: string;
  policy_id: string;
};

export type RegisterRequest = {
  call_id: string;
  given_name: string;
  first_surname: string;
  second_surname: string;
  national_id: string;
  date_of_birth: string;
  phone: string;
  email: string;
  insurer: string;
};

export type RescheduleRequest = {
  call_id: string;
  appointment_id: string;
  provider_id: string;
  location_id: string;
  slot: string;
  policy_id: string;
};

export type CancelRequest = { call_id: string; appointment_id: string };
export type ReasonRequest = { call_id: string; reason: OutcomeReason };

export type SubmittedAction =
  | ({ action: "REGISTER" } & { new_patient?: Omit<RegisterRequest, "call_id"> } & Partial<
        Omit<RegisterRequest, "call_id">
      >)
  | ({ action: "BOOK" } & Omit<BookRequest, "call_id">)
  | ({ action: "RESCHEDULE" } & Omit<RescheduleRequest, "call_id">)
  | ({ action: "CANCEL"; appointment_id: string })
  | ({ action: "NO_ACTION"; reason: OutcomeReason })
  | ({ action: "ESCALATE"; reason: OutcomeReason });

export type SubmitResponse = {
  call_id: string;
  received_at: string;
  record: { actions: SubmittedAction[] };
};

export type ClinicSourceInfo = {
  id: string;
  name: string;
  kind: "fixture" | "rest";
  baseUrl?: string;
};

export interface ClinicSource {
  info: ClinicSourceInfo;
  health(): Promise<{ ok: boolean; detail?: string }>;
  clinic(): Promise<ClinicCatalog>;
  directory(query: DirectoryQuery): Promise<DirectoryResponse>;
  availability(query: AvailabilityQuery): Promise<AvailabilityResponse>;
  appointments(
    patientId: string,
    when?: AppointmentWindow,
  ): Promise<{ appointments: Appointment[] }>;
  submitBook(body: BookRequest): Promise<SubmitResponse>;
  submitRegister(body: RegisterRequest): Promise<SubmitResponse>;
  submitReschedule(body: RescheduleRequest): Promise<SubmitResponse>;
  submitCancel(body: CancelRequest): Promise<SubmitResponse>;
  submitNoAction(body: ReasonRequest): Promise<SubmitResponse>;
  submitEscalate(body: ReasonRequest): Promise<SubmitResponse>;
}
