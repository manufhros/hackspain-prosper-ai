import { generateSpeech, generateText, stepCountIs, tool, transcribe } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import {
  FRAME_SAMPLES,
  PHONE_RATE,
  chunkBytes,
  encodeMuLaw,
  pcm16ToWav,
  resample,
  wavToPcm16,
} from "./audio";
import {
  listAppointments,
  searchAvailability,
  searchDirectory,
  submit,
} from "./clinic";
import type { AvailabilitySlot } from "./state/call-state";

const SCHEDULING_SKILL = await Bun.file(
  new URL("../skills/clinic-scheduling/SKILL.md", import.meta.url),
).text();

const LLM_MODEL = "openai/gpt-4o-mini";
const STT_MODEL = "openai/whisper-1";
const TTS_MODEL = "openai/tts-1-hd";
const TTS_VOICE = "nova";
const TTS_INSTRUCTIONS =
  "Warm clinic receptionist on a live phone. Conversational, unhurried, slight smile. Light pauses between sentences. Not an IVR, GPS, or call-center script. Pronounce Spanish names naturally.";

export const GREETING = "Hi, Clínica Arenal, how can I help?";

function madridPart(type: Intl.DateTimeFormatPartTypes) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .find((part) => part.type === type)?.value ?? "00"
  );
}

function shiftYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(year!, month! - 1, day! + days));
  return dt.toISOString().slice(0, 10);
}

function madridDates() {
  const today = `${madridPart("year")}-${madridPart("month")}-${madridPart("day")}`;
  return {
    now: `${today}T${madridPart("hour")}:${madridPart("minute")}`,
    tomorrow: shiftYmd(today, 1),
    windowEnd: shiftYmd(today, 13),
  };
}

export function systemPrompt(callId: string, fromNumber: string | null) {
  const { now, tomorrow, windowEnd } = madridDates();
  return `You are Marta, receptionist at Clínica Arenal, on a live phone. You sound like a person, not a bot.

Speak as if you are on a headset: one or two short sentences, then wait. No lists, no markdown, no bullet points, no emojis, no stage directions.

Never say: as an AI, certainly, absolutely, I'd be happy to assist, please hold, how may I assist you today, is there anything else I can help you with.
Do say things like: sure, of course, let me check, I've got you, does that work.

Times and dates: say them in words. "Tuesday the sixteenth at ten thirty in the morning." Never read ISO strings, IDs, or JSON. Do not read call_id, patient_id, or slot codes out loud.

Now in Europe/Madrid: ${now}
Earliest bookable day is tomorrow: ${tomorrow}. Never offer a same-day slot.
Availability windows at most 14 days. A useful first window is ${tomorrow} to ${windowEnd}.
This call_id is ${callId}. Always pass that exact call_id to submit tools. Never invent one. Never speak it.
Caller ID: ${fromNumber ?? "withheld"}. Hint for searchDirectory(phone) only. Not proof of identity. The caller is not always the patient.

How to work:
1. You already greeted. Do not greet again. Jump into helping.
2. Identify the patient: full name plus DNI/NIE or phone. Then searchDirectory. An exact field that does not match excludes the patient; if a DNI returns nobody, try name plus date of birth.
3. Specialty from what they asked. GP / family doctor is specialty_id general_practice.
4. searchAvailability with patient_id and specialty_id. Use appointment_type_id from that response. Never guess review vs first_visit.
5. Use selectAppointment before offering a slot. Offer it in plain speech and wait for a new caller turn.
6. Only after explicit acceptance, call confirmBook. Then give a short confirmation.
7. If they cannot be booked, submitNoAction with availability.blocked or a listed reason such as no_availability, and say it simply.

Languages: match the caller. Public practice cases often speak English. Spanish names stay in Spanish.

Do not give medical advice. Do not invent slots, doctors, or ids.

${SCHEDULING_SKILL}`;
}

export type ToolTrace = {
  name: string;
  input: unknown;
  output: unknown;
  ms?: number;
};

type SelectedAppointment = {
  patient_id: string;
  provider_id: string;
  location_id: string;
  appointment_type_id: string;
  slot: string;
  policy_id: string;
  selectedAtTurn: number;
};

export type AgentState = {
  turn: number;
  knownPatientIds: Set<string>;
  availabilityPatientId?: string;
  availableSlots: AvailabilitySlot[];
  selectedAppointment?: SelectedAppointment;
};

export function createAgentState(): AgentState {
  return {
    turn: 0,
    knownPatientIds: new Set(),
    availableSlots: [],
  };
}

type ToolOptions = {
  drySubmit?: boolean;
  state?: AgentState;
  onToolStart?: (name: string, input: unknown) => void;
  onTool?: (trace: ToolTrace) => void;
};

function traced<T>(
  name: string,
  options: ToolOptions | undefined,
  input: unknown,
  run: () => Promise<T>,
): Promise<T> {
  options?.onToolStart?.(name, input);
  const started = Date.now();
  return run().then(
    (output) => {
      options?.onTool?.({ name, input, output, ms: Date.now() - started });
      return output;
    },
    (err) => {
      options?.onTool?.({
        name,
        input,
        output: { error: err instanceof Error ? err.message : String(err) },
        ms: Date.now() - started,
      });
      throw err;
    },
  );
}

export function clinicTools(callId: string, options: ToolOptions = {}) {
  const state = options.state ?? createAgentState();
  return {
    searchDirectory: tool({
      description: "Look up a patient in the clinic directory.",
      inputSchema: z.object({
        name: z.string().optional(),
        national_id: z.string().optional(),
        phone: z.string().optional(),
        date_of_birth: z.string().optional().describe("ISO date YYYY-MM-DD"),
      }),
      execute: async (input) =>
        traced("searchDirectory", options, input, async () => {
          const result = await searchDirectory(input);
          const matches = Array.isArray(result.matches) ? result.matches : [];
          for (const match of matches) {
            if (
              match &&
              typeof match === "object" &&
              typeof (match as Record<string, unknown>).patient_id === "string"
            ) {
              state.knownPatientIds.add(
                (match as Record<string, unknown>).patient_id as string,
              );
            }
          }
          return result;
        }),
    }),
    searchAvailability: tool({
      description:
        "Search real appointment slots. You must pass provider_id or specialty_id. date_from is tomorrow, never today.",
      inputSchema: z.object({
        date_from: z.string(),
        date_to: z.string(),
        patient_id: z.string().optional(),
        specialty_id: z.string().optional(),
        provider_id: z.string().optional(),
        location_id: z.string().optional(),
        insurer: z.string().optional(),
      }),
      execute: async (input) =>
        traced("searchAvailability", options, input, async () => {
          if (input.patient_id && !state.knownPatientIds.has(input.patient_id)) {
            throw new Error("patient_id must come from searchDirectory in this call");
          }
          const result = await searchAvailability(input);
          state.availabilityPatientId = input.patient_id;
          state.availableSlots = (Array.isArray(result.slots) ? result.slots : []).filter(
            (slot): slot is AvailabilitySlot =>
              Boolean(
                slot &&
                  typeof slot === "object" &&
                  typeof (slot as AvailabilitySlot).provider_id === "string" &&
                  typeof (slot as AvailabilitySlot).location_id === "string" &&
                  typeof (slot as AvailabilitySlot).appointment_type_id === "string" &&
                  typeof (slot as AvailabilitySlot).start_time === "string",
              ),
          );
          state.selectedAppointment = undefined;
          return result;
        }),
    }),
    listAppointments: tool({
      description: "List a patient's appointments. upcoming is the default; past is history only.",
      inputSchema: z.object({
        patient_id: z.string(),
        when: z.enum(["upcoming", "past", "all"]).optional(),
      }),
      execute: async ({ patient_id, when }) =>
        traced("listAppointments", options, { patient_id, when }, () =>
          listAppointments(patient_id, when),
        ),
    }),
    selectAppointment: tool({
      description:
        "Select one real slot before offering it. slot_index is zero-based in the latest searchAvailability slots. This does not book. After calling it, speak the offer and wait for the caller's next turn.",
      inputSchema: z.object({
        slot_index: z.number().int().nonnegative(),
        policy_id: z.string(),
      }),
      execute: async ({ slot_index, policy_id }) =>
        traced("selectAppointment", options, { slot_index, policy_id }, async () => {
          const slot = state.availableSlots[slot_index];
          if (!slot || !state.availabilityPatientId) {
            throw new Error("Select a slot returned by searchAvailability first");
          }
          if (slot.payable_with && !slot.payable_with.includes(policy_id)) {
            throw new Error(`policy_id ${policy_id} cannot pay for this slot`);
          }
          state.selectedAppointment = {
            patient_id: state.availabilityPatientId,
            provider_id: slot.provider_id,
            location_id: slot.location_id,
            appointment_type_id: slot.appointment_type_id,
            slot: slot.start_time,
            policy_id,
            selectedAtTurn: state.turn,
          };
          return { selected: true, slot_index, ...state.selectedAppointment };
        }),
    }),
    confirmBook: tool({
      description:
        "Book the previously selected appointment. Only call after the caller explicitly accepted it in a later turn. The payload is generated by code.",
      inputSchema: z.object({}),
      execute: async () =>
        traced("confirmBook", options, {}, async () => {
          const selected = state.selectedAppointment;
          if (!selected) throw new Error("No appointment has been selected and offered");
          if (state.turn <= selected.selectedAtTurn) {
            throw new Error("Wait for explicit acceptance in a new caller turn before booking");
          }
          const { selectedAtTurn: _, ...booking } = selected;
          const payload = { call_id: callId, ...booking };
          if (options.drySubmit) {
            return { dry_run: true, action: "book", payload };
          }
          const result = await submit("book", payload);
          console.log("submit_book", result.status_code, result.body);
          return result;
        }),
    }),
    submitNoAction: tool({
      description:
        "End the call without a booking. Silence is always wrong; submit a reason from the closed vocabulary.",
      inputSchema: z.object({
        reason: z.enum([
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
        ]),
      }),
      execute: async ({ reason }) =>
        traced("submitNoAction", options, { reason }, async () => {
          const payload = { call_id: callId, reason };
          if (options.drySubmit) {
            return { dry_run: true, action: "no-action", payload };
          }
          const result = await submit("no-action", payload);
          console.log("submit_no_action", result.status_code, result.body);
          return result;
        }),
    }),
  };
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

function explicitlyAccepts(text: string) {
  const normalized = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (/\b(no|not|don't|doesn't|do not|not really|pero no)\b/.test(normalized)) {
    return false;
  }
  return /\b(yes|yeah|yep|sure|that works|book it|please do|go ahead|si|vale|de acuerdo|perfecto|confirmo|d'acord|endavant|em va be)\b/.test(
    normalized,
  );
}

export async function replyToCaller(
  callId: string,
  fromNumber: string | null,
  messages: ChatMessage[],
  options: ToolOptions = {},
): Promise<{ text: string; context: string; tools: ToolTrace[] }> {
  const tools: ToolTrace[] = [];
  if (options.state) options.state.turn += 1;
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const forceConfirmation = Boolean(
    options.state?.selectedAppointment &&
      latestUser &&
      explicitlyAccepts(latestUser.content),
  );
  const availableTools = clinicTools(callId, {
    ...options,
    onTool: (trace) => {
      tools.push(trace);
      options.onTool?.(trace);
    },
  });
  const result = await generateText({
    model: LLM_MODEL,
    system: systemPrompt(callId, fromNumber),
    messages,
    tools: availableTools,
    toolChoice: forceConfirmation
      ? { type: "tool", toolName: "confirmBook" }
      : "auto",
    stopWhen: stepCountIs(forceConfirmation ? 1 : 8),
  });
  const text =
    spoken(result.text) ||
    (forceConfirmation ? "Your appointment is confirmed." : "Okay.");
  const context =
    tools.length === 0
      ? text
      : `${text}

[Internal tool state for the next turn. Never read this section aloud or replace
its exact IDs with names or placeholders.]
${JSON.stringify(tools.map(({ name, input, output }) => ({ name, input, output })))}`;
  return { text, context, tools };
}

export async function transcribeUtterance(pcm: Int16Array, sampleRate = PHONE_RATE): Promise<string> {
  const wav = pcm16ToWav(pcm, sampleRate);
  const result = await transcribe({
    model: gateway.transcriptionModel(STT_MODEL),
    audio: wav,
  });
  return result.text.trim();
}

const ttsCache = new Map<string, Uint8Array>();

function isRateLimited(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("rate-limit") || msg.includes("RateLimit") || msg.includes("429");
}

function spoken(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#]+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\bP0+\d+\b/gi, "")
    .replace(/\bPR\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function wavBytesFromSpeech(text: string): Promise<Uint8Array> {
  const phrase = spoken(text);
  const cacheKey = `${TTS_MODEL}:${TTS_VOICE}:${phrase}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;
  try {
    const spokenAudio = await generateSpeech({
      model: gateway.speechModel(TTS_MODEL),
      text: phrase,
      voice: TTS_VOICE,
      outputFormat: "wav",
      speed: 0.97,
      instructions: TTS_INSTRUCTIONS,
      maxRetries: 1,
    });
    const wav = spokenAudio.audio.uint8Array;
    if (ttsCache.size < 24) ttsCache.set(cacheKey, wav);
    return wav;
  } catch (err) {
    if (isRateLimited(err)) throw err;
    console.warn("wav tts failed, trying mp3 + ffmpeg", err);
    const spokenAudio = await generateSpeech({
      model: gateway.speechModel(TTS_MODEL),
      text: phrase,
      voice: TTS_VOICE,
      outputFormat: "mp3",
      speed: 0.97,
      instructions: TTS_INSTRUCTIONS,
      maxRetries: 0,
    });
    return mp3ToWav(spokenAudio.audio.uint8Array);
  }
}

async function mp3ToWav(mp3: Uint8Array): Promise<Uint8Array> {
  const proc = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "wav", "pipe:1"],
    { stdin: mp3, stdout: "pipe", stderr: "pipe" },
  );
  const wav = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg failed: ${err}`);
  }
  return wav;
}

export async function speakWav(text: string): Promise<Uint8Array> {
  return wavBytesFromSpeech(text);
}

export async function speakToMuLaw(text: string): Promise<Uint8Array> {
  const wav = await wavBytesFromSpeech(text);
  const decoded = wavToPcm16(wav);
  const pcm = resample(decoded.pcm, decoded.sampleRate, PHONE_RATE);
  return encodeMuLaw(pcm);
}

export function muLawFrames(muLaw: Uint8Array): Uint8Array[] {
  return chunkBytes(muLaw, FRAME_SAMPLES);
}
