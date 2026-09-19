export type ProblemId =
  | "simple_booking"
  | "switchboard"
  | "doctor_and_site"
  | "the_new_patient"
  | "when_exactly"
  | "the_rules"
  | "no_slot_free"
  | "change_and_cancel"
  | "third_party"
  | "triage"
  | "languages"
  | "noise"
  | "difficult_caller"
  | "adversarial"
  | "nearest_site"
  | "the_questions"
  | "second_policy"
  | "the_real_call"
  | (string & {});

export const PROBLEM_WEIGHTS: Record<string, number> = {
  simple_booking: 1,
  switchboard: 0,
  doctor_and_site: 2,
  the_new_patient: 2,
  when_exactly: 2,
  the_rules: 3,
  no_slot_free: 2,
  change_and_cancel: 2,
  third_party: 3,
  triage: 3,
  languages: 3,
  noise: 3,
  difficult_caller: 4,
  adversarial: 4,
  nearest_site: 3,
  the_questions: 3,
  second_policy: 4,
  the_real_call: 5,
};

export type PersonaData = {
  full_name?: string;
  given_name?: string;
  first_surname?: string;
  second_surname?: string;
  national_id?: string;
  phone?: string;
  date_of_birth?: string;
  insurer?: string;
  email?: string;
  caller_national_id?: string;
  caller_phone?: string;
  patient_full_name?: string;
  patient_given_name?: string;
  patient_first_surname?: string;
  patient_second_surname?: string;
  patient_national_id?: string;
  patient_phone?: string;
  patient_date_of_birth?: string;
  patient_insurer?: string;
};

export type PublicCase = {
  id: string;
  problem_id: ProblemId;
  reference_time: string;
  language: string;
  summary: string;
  caller_prompt: string;
  persona: {
    name: string;
    phone?: string;
    voice?: string;
    description?: string;
    data: PersonaData;
    objectives?: string[];
  };
  expected: {
    acceptable: Array<{ actions: Array<Record<string, unknown> & { action: string }> }>;
  };
};

export type PublicCaseFile = {
  problem_id: string | null;
  cases: PublicCase[];
};

export type CaseCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type CaseRunResult = {
  caseId: string;
  problemId: string;
  summary: string;
  language: string;
  expectedActions: string[];
  checks: CaseCheck[];
  passed: boolean;
};
