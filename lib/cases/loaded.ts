export type LoadedCase = {
  id: string;
  problem_id: string;
  summary: string;
  language: string;
  caller_prompt: string;
  objectives?: string[];
  persona: {
    name: string;
    phone?: string;
    data: {
      given_name?: string;
      first_surname?: string;
      second_surname?: string;
      national_id?: string;
      phone?: string;
      date_of_birth?: string;
      insurer?: string;
      patient_national_id?: string;
      patient_phone?: string;
      patient_given_name?: string;
      patient_full_name?: string;
    };
  };
  expected: Array<Record<string, unknown> & { action: string }>;
};
