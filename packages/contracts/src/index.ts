import { z } from "zod";

export const reasons = [
  "not_eligible_age",
  "referral_required",
  "provider_not_in_network",
  "specialty_not_covered",
  "location_not_covered",
  "insurer_referral_required",
  "allowance_exhausted",
  "provider_on_leave",
  "location_hours",
  "type_not_offered",
  "patient_history",
  "no_availability",
  "clinic_closed",
  "patient_not_found",
  "provider_not_found",
  "caller_not_authorised",
  "out_of_scope",
  "medical_emergency",
] as const;
export const reasonSchema = z.enum(reasons);
const id = z.string().min(1).max(200);
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s),
    "Invalid date",
  );
const instant = z.string().datetime({ offset: true });
export const patientRegistration = z
  .object({
    given_name: id,
    first_surname: id,
    second_surname: id,
    national_id: id,
    date_of_birth: isoDate,
    phone: id,
    email: z.string().email(),
    insurer: z.enum([
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
    ]),
  })
  .strict();
export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("BOOK"),
      patient_id: id,
      provider_id: id,
      location_id: id,
      appointment_type_id: id,
      slot: instant,
      policy_id: id,
    })
    .strict(),
  z
    .object({
      action: z.literal("RESCHEDULE"),
      appointment_id: id,
      provider_id: id,
      location_id: id,
      slot: instant,
      policy_id: id,
    })
    .strict(),
  z.object({ action: z.literal("CANCEL"), appointment_id: id }).strict(),
  z
    .object({ action: z.literal("REGISTER"), new_patient: patientRegistration })
    .strict(),
  z.object({ action: z.literal("NO_ACTION"), reason: reasonSchema }).strict(),
  z.object({ action: z.literal("ESCALATE"), reason: reasonSchema }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const requestSchema = z
  .object({
    date_from: isoDate,
    date_to: isoDate,
    specialty_id: id.optional(),
    provider_id: id.optional(),
    location_id: id.optional(),
    period: z.enum(["any", "morning", "afternoon"]).default("any"),
    insurer: z.array(id).max(2).optional(),
  })
  .strict()
  .refine(
    (v) => !!v.specialty_id || !!v.provider_id,
    "Specify specialty or provider",
  );
export type BookingRequest = z.infer<typeof requestSchema>;
export type Patient = {
  patient_id: string;
  given_name: string;
  first_surname: string;
  second_surname: string;
  national_id: string;
  date_of_birth: string;
  phone: string;
  insurer: string;
  note: string;
  has_visited_before: boolean;
  matched_fields?: string[];
};
export type PatientQuery = Partial<
  Pick<Patient, "national_id" | "date_of_birth" | "phone">
> & { name?: string };
export type Slot = {
  provider_id: string;
  provider_name: string;
  specialty_id: string;
  location_id: string;
  appointment_type_id: string;
  start_time: string;
  duration_minutes: number;
  payable_with: string[];
};
export type Appointment = {
  appointment_id: string;
  patient_id: string;
  provider_id: string;
  location_id: string;
  appointment_type_id: string;
  start_time: string;
};
export type Availability = {
  slots: Slot[];
  blocked: { provider_id: string; restriction: string }[];
};
export interface ClinicDataSource {
  readonly id: string;
  catalog(signal?: AbortSignal): Promise<unknown>;
  patients(query: PatientQuery, signal?: AbortSignal): Promise<Patient[]>;
  availability(
    request: BookingRequest & { patient_id: string },
    signal?: AbortSignal,
  ): Promise<Availability>;
  appointments(patientId: string, signal?: AbortSignal): Promise<Appointment[]>;
}
export type Receipt = {
  status: "accepted" | "duplicate" | "rejected" | "expired";
  httpStatus: number;
  detail?: string;
};
export interface ActionSink {
  readonly id: string;
  deliver(
    callId: string,
    action: Action,
    signal?: AbortSignal,
  ): Promise<Receipt>;
}
export type AudioFormat = {
  encoding: "mulaw" | "pcm16";
  sampleRate: 8000 | 16000 | 24000;
  channels: 1;
};
export const TELEPHONE_AUDIO: AudioFormat = {
  encoding: "mulaw",
  sampleRate: 8000,
  channels: 1,
};
export type AudioFrame = { data: Uint8Array; format: AudioFormat };
export type Capabilities = {
  input: AudioFormat[];
  output: AudioFormat[];
  textInput: boolean;
  transcripts: boolean;
  tools: boolean;
  interrupt: boolean;
  turnDetection: "provider" | "application";
  languages: readonly string[];
};
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
export type ToolResult = { ok: boolean; data?: unknown; error?: string };
export type EngineHost = {
  userText(text: string): void;
  assistantText(text: string): void;
  audio(frame: AudioFrame): Promise<void>;
  interrupt(): void;
  tool(name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult>;
  context(): string;
  event(type: string, data?: unknown): void;
};
export interface ConversationEngine {
  readonly id: string;
  readonly capabilities: Capabilities;
  start(host: EngineHost, tools: ToolDefinition[]): Promise<void>;
  acceptAudio(frame: AudioFrame): Promise<void>;
  acceptText(text: string): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
export type Transcript = { text: string; final: boolean; language?: string; metadataOnly?: boolean };
export interface SpeechRecognizer {
  start(
    onText: (text: Transcript) => void,
    onError: (error: Error) => void,
  ): Promise<void>;
  write(frame: AudioFrame): void;
  close(): Promise<void>;
}
export interface SpeechSynthesizer {
  synthesize(text: string, signal: AbortSignal): AsyncIterable<AudioFrame>;
}
export interface TurnDetector {
  observe(
    transcript: Transcript,
    onTurn: (text: string) => void,
    onSpeech: () => void,
  ): void;
  close(): void;
}
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ModelToolCall[];
};
export type ModelToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type ModelReply = { text: string; calls: ModelToolCall[] };
export interface LanguageModel {
  complete(
    messages: ModelMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): Promise<ModelReply>;
}
export type DomainEvent = {
  id: string;
  callId: string;
  sequence: number;
  at: string;
  type: string;
  data: unknown;
};
export type Delivery = {
  id: string;
  callId: string;
  taskId: string;
  action: Action;
  status: "pending" | "accepted" | "duplicate" | "rejected" | "expired";
  attempts: number;
  deadline: string;
  receipt?: Receipt;
};
export interface Repository {
  append(event: DomainEvent): Promise<void>;
  events(callId?: string): Promise<DomainEvent[]>;
  putDelivery(delivery: Delivery): Promise<void>;
  deliveries(): Promise<Delivery[]>;
  close(): Promise<void>;
}
export const sameFormat = (a: AudioFormat, b: AudioFormat) =>
  a.encoding === b.encoding &&
  a.sampleRate === b.sampleRate &&
  a.channels === b.channels;
export class DomainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DomainError";
  }
}
