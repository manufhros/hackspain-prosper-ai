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
  | "privado";

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

export type ClinicInsurerRef = {
  id: string;
  name: string;
};

export type ClinicLeave = {
  start: string;
  end: string;
  reason: string;
};

export type ClinicDay = {
  weekday: string;
  intervals: string[];
};

export type ClinicSchedule = {
  location_id: string;
  location_name: string;
  days: ClinicDay[];
};

export type ClinicCalendar = {
  starts: string;
  ends: string;
  max_span_days: number;
  slot_minutes: number;
  closure_days: string[];
  appointment_count: number;
};

export type ClinicRestriction = {
  id: string;
  title: string;
  explanation: string;
};

export type ClinicProvider = {
  id: string;
  name: string;
  specialty_id: string;
  specialty_name: string;
  languages: string[];
  appointment_type_names: string[];
  location_names: string[];
  schedules: ClinicSchedule[];
  accepted_insurers: ClinicInsurerRef[];
  refused_insurers: ClinicInsurerRef[];
  leave: ClinicLeave | null;
};

export type ClinicSpecialty = {
  id: string;
  name: string;
  min_age_months: number;
  max_age_months: number | null;
  referral_required: boolean;
  provider_names: string[];
  covered_by: ClinicInsurerRef[];
  not_covered_by: ClinicInsurerRef[];
};

export type ClinicAppointmentType = {
  id: string;
  name: string;
  duration_minutes: number;
  new_patient_requirement: string;
  guidance: string;
  provider_names: string[];
  specialty_id: string | null;
  specialty_name: string | null;
};

export type ClinicLocation = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  hours: ClinicDay[];
  provider_names: string[];
  covered_by: ClinicInsurerRef[];
  not_covered_by: ClinicInsurerRef[];
};

export type ClinicPlan = {
  id: string;
  name: string;
  covered_specialty_names: string[];
  uncovered_specialty_names: string[];
  covered_location_names: string[];
  uncovered_location_names: string[];
  accepted_by: string[];
  refused_by: string[];
  holders: number;
};

export type ClinicCatalog = {
  clinic_name: string;
  patient_count: number;
  calendar: ClinicCalendar;
  restrictions: ClinicRestriction[];
  providers: ClinicProvider[];
  specialties: ClinicSpecialty[];
  appointment_types: ClinicAppointmentType[];
  locations: ClinicLocation[];
  plans: ClinicPlan[];
};

export type PatientMatch = {
  patient_id: string;
  given_name: string;
  first_surname: string;
  second_surname: string;
  national_id: string;
  date_of_birth: string;
  phone: string;
  sex: string;
  has_visited_before: boolean;
  insurer: string;
  referrals: string[];
  note: string;
  match_score: number;
  matched_fields: string[];
};

export type DirectoryResponse = {
  matches: PatientMatch[];
};

export type Appointment = {
  appointment_id: string;
  patient_id: string;
  provider_id: string;
  location_id: string;
  appointment_type_id: string;
  start_time: string;
  duration_minutes: number;
};

export type AvailabilitySlot = {
  provider_id: string;
  provider_name: string;
  specialty_id: string;
  location_id: string;
  appointment_type_id: string;
  start_time: string;
  duration_minutes: number;
  payable_with: string[];
};

export type AvailabilityProvider = {
  id: string;
  name: string;
  specialty_id: string;
  languages: string[];
  accepted_insurers: string[];
  locations: string[];
  on_leave_until: string | null;
};

export type AvailabilityAppointmentType = {
  id: string;
  name: string;
  duration_minutes: number;
  new_patient_requirement: string;
  guidance: string;
};

export type AvailabilityBlocked = {
  provider_id: string;
  restriction: string;
};

export type AvailabilityResponse = {
  providers: AvailabilityProvider[];
  appointment_type: AvailabilityAppointmentType;
  slots: AvailabilitySlot[];
  blocked: AvailabilityBlocked[];
};

export type DirectoryQuery = {
  name?: string;
  national_id?: string;
  phone?: string;
  date_of_birth?: string;
};

export type AvailabilityQuery = {
  date_from: string;
  date_to: string;
  provider_id?: string;
  specialty_id?: string;
  location_id?: string;
  patient_id?: string;
  insurer?: Insurer[];
};

export type BookRequest = {
  call_id: string;
  patient_id: string;
  provider_id: string;
  location_id: string;
  appointment_type_id: string;
  slot: string;
  policy_id: Insurer;
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
  insurer: Insurer;
};

export type RescheduleRequest = {
  call_id: string;
  appointment_id: string;
  provider_id: string;
  location_id: string;
  slot: string;
  policy_id: Insurer;
};

export type CancelRequest = {
  call_id: string;
  appointment_id: string;
};

export type ReasonRequest = {
  call_id: string;
  reason: OutcomeReason;
};

export type SubmittedAction =
  | ({ action: "REGISTER" } & { new_patient: Omit<RegisterRequest, "call_id"> })
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
