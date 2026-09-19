export type Source = "llamadas" | "demo";

export type LoggedCall = {
  id: string;
  phone: string | null;
  started: string | null;
  minutes: number;
  patient: string | null;
  patientId: string | null;
  insurer: string | null;
  site: string | null;
  siteName: string;
  outcome: string;
  reason: string | null;
  motive: string;
  slot: string | null;
  providerId: string | null;
  source: Source;
  sourceFile: string | null;
  resolution?: "resolved" | "abandoned" | "escalated" | "unknown";
  route?: "general" | "actions" | "human" | null;
  intent?: string | null;
  toolCalls?: number;
  toolErrors?: number;
  avgToolLatencyMs?: number | null;
  frustrationScore?: number;
  sentiment?: "positive" | "neutral" | "negative" | null;
  patientRating?: number | null;
  escalationAppropriate?: boolean | null;
  configVersion?: string | null;
  actions?: Array<{
    name: string;
    at: string | null;
    reason: string | null;
    summary: string;
  }>;
};
