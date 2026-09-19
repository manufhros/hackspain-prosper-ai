export type PublicCase = {
  id: string;
  problem_id: string;
  language: string;
  summary: string;
  caller_prompt: string;
  persona: {
    name: string;
    phone?: string;
    voice?: string;
    data: { phone?: string };
  };
  expected: {
    acceptable: Array<{ actions: Array<{ action: string }> }>;
  };
};

export type PublicCaseFile = {
  cases: PublicCase[];
};

export type SimCase = {
  id: string;
  problem_id: string;
  language: string;
  title: string;
  prompt: string;
  expected: string;
  patient: string;
  phone: string;
};
