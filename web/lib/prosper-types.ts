// Tipos de los endpoints de /leaderboard/api/* (inferidos de respuestas reales).
// Los campos marcados `unknown` existen pero no se han inspeccionado en detalle.

// ── Comunes ─────────────────────────────────────────────────────────────
export type RunState = "running" | "completed" | "failed";
export type CaseStatus = "passed" | "failed" | "active" | "harness_error";
export type Attribution = "none" | "agent_issue" | "harness_issue" | "inconclusive" | null;

export interface FieldCheck {
  field: string; // action, appointment_type_id, location_id, patient_id, policy_id, provider_id, slot
  expected: string;
  submitted: string | null; // null = el agente no envió submission
  matched: boolean;
}

export interface TranscriptLine {
  seconds: number;
  speaker: "Agent" | "Patient";
  text: string;
}

export interface Case {
  call_id: string;
  label: string; // "The Switchboard · call 1"
  status: CaseStatus;
  hidden: boolean;
  problem_id: string; // switchboard, simple_booking, the_rules, doctor_and_site, ...
  fields: FieldCheck[]; // vacío en "switchboard"
  transcript: TranscriptLine[];
  has_audio: boolean;
  attribution: Attribution;
  signal_codes: string[]; // harness_socket_error, missing_record, agent_silence, ...
  points: number | null;
  points_available: number | null;
}

// ── GET /api/session ────────────────────────────────────────────────────
export interface Session {
  viewer: { team_id: string; organiser: boolean; dev: boolean; viewing_as: string | null };
  dev_login: boolean;
  home: string;
}

// ── GET /api/board ──────────────────────────────────────────────────────
export interface Board {
  generated_at: string;
  frozen: boolean;
  entries: { rank: number; name: string; points: number }[];
}

// ── GET /api/teams/{team_id}  (vía proxy: /api/prosper/team) ────────────
export interface Run {
  run_id: string;
  public: boolean;
  state: RunState;
  started_at: string;
  voided: boolean;
  explanation: string | null;
  cases: Case[];
}

export interface Submission {
  call_id: string;
  submitted_at: string;
  outcome: "BOOK" | "NO_ACTION" | "REGISTER" | (string & {});
  detail: string; // "BOOK P00095 with PR01 at centro on 21/09 09:15 (asisa)"
  known_call: boolean;
}

export interface TeamPayload {
  team_id: string;
  name: string;
  generated_at: string;
  stats: {
    runs: number;
    private_runs: number;
    cases_judged: number;
    cases_passed: number;
    harness_errors: number;
    best_points: number | null;
    rank: number | null;
    pass_rate: number; // 0..1
    field_failures: { field: string; failures: number }[];
  };
  eligibility: { active_run: boolean; withdrawn: boolean; public_wait: number; private_wait: number };
  integration: {
    endpoint?: string; // el proxy lo elimina: lleva un token
    key_active: boolean;
    last_call_at: string | null;
  };
  runs: Run[]; // más reciente primero
  submissions: Submission[];
}

// ── GET /api/problems ───────────────────────────────────────────────────
export interface ProblemSummary {
  id: string;
  title: string;
  number: number;
  weight: number;
  examples: number;
}
export interface ProblemsList {
  problems: ProblemSummary[];
}

// ── GET /api/problems/{id} ──────────────────────────────────────────────
export interface ProblemDetail {
  id: string;
  title: string;
  statement: string;
  weight: number;
  examples: {
    case_id: string;
    caller: string;
    summary: string;
    accepted: unknown[];
    dials: number;
  }[];
}

// ── GET /api/problems/{id}/submissions  (~100 KB) ───────────────────────
export interface ProblemSubmissions {
  problem_id: string;
  title: string;
  passed: number;
  failed: number;
  attempts: { run_id: string; started_at: string; state: RunState; case: Case }[];
}

// ── GET /api/clinic ─────────────────────────────────────────────────────
// Una sola petición alimenta todas las pestañas (Providers, Specialties,
// Appointment types, Locations, Insurance, Rules).
export interface Clinic {
  clinic_name: string;
  patient_count: number;
  calendar: {
    starts: string;
    ends: string;
    max_span_days: number;
    slot_minutes: number;
    closure_days: string[];
    appointment_count: number;
  };
  restrictions: { id: string; title: string; explanation: string }[]; // pestaña "Rules"
  providers: {
    id: string;
    name: string;
    specialty_id: string;
    specialty_name: string;
    languages: string[];
    appointment_type_names: string[];
    location_names: string[];
    schedules: unknown[];
    accepted_insurers: unknown[];
    refused_insurers: unknown[];
    leave: unknown | null;
  }[];
  specialties: { id: string; name: string; min_age_months: number; max_age_months: number | null; [k: string]: unknown }[];
  [k: string]: unknown; // appointment types, locations, insurers…
}

// ── GET /api/clinic/patients?offset=&limit= ─────────────────────────────
export interface Patient {
  patient_id: string; // "P00001"
  given_name: string;
  first_surname: string;
  second_surname: string;
  national_id: string;
  date_of_birth: string; // "2001-09-19"
  phone: string;
  sex: string; // "F" | "M"
  has_visited_before: boolean;
  insurer: unknown;
  secondary_insurer: unknown | null;
  referrals: unknown[];
  note: string;
  matched_fields: string[];
  appointments: unknown[];
}
export interface PatientsPage {
  patients: Patient[];
  offset: number;
  total: number;
  searched: boolean;
}

// ── Notas locales (web/data/run-notes.json) ─────────────────────────────
export interface CallNote {
  verdict: string;
  note: string;
}
export interface RunNote {
  title: string;
  source: string;
  summary: string;
  findings: { title: string; detail: string }[];
  calls: Record<string, CallNote>; // por call_id completo
}
export type RunNotes = Record<string, RunNote>; // por run_id
