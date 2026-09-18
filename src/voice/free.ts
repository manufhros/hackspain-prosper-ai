import { type Outcome, type TranscriptTurn } from "../data";
import { Receptionist, type ClinicReader, type TraceEvent } from "./agent";
import { spokenRoundtrip } from "./rehearsal";
import { simulatedSubmission, type SubmissionPreview } from "./resolution";
import { type Inference } from "./runtime";

export type VoiceLanguage = "en" | "es" | "ca";
export interface FreeConversationReport {
  session_id: string;
  mode: "free_conversation";
  language: VoiceLanguage;
  reference_time: string;
  status: "completed" | "ended" | "cancelled" | "error";
  record?: Outcome;
  platform_submission: false;
  submission_preview: SubmissionPreview;
  transcript: TranscriptTurn[];
  events: TraceEvent[];
  elapsed_ms: number;
  error?: string;
}

// No case, persona, expected answer, evaluator or simulated caller is involved.
// Each inference operation retains its runtime timeout, but the conversation has
// no scripted turn count or three-minute rehearsal deadline.
export async function runFreeConversation(
  inference: Inference, clinic: ClinicReader, language: VoiceLanguage, signal: AbortSignal,
  update: (event: TraceEvent) => void,
  input: (signal: AbortSignal) => Promise<string | null>,
): Promise<FreeConversationReport> {
  const started = performance.now();
  const referenceTime = new Date().toISOString();
  const events: TraceEvent[] = [];
  const emit = (event: TraceEvent) => { events.push(event); update(event); };
  const agent = new Receptionist(inference, clinic, referenceTime, language, emit);
  agent.messages[0]!.content += "\nThis is a free conversation with a real tester. There is no predefined caller identity, objective, or script. Respond to what they actually ask. For general clinic questions, use clinic information without requiring patient identification. Follow the same confirm-once rule: after acceptance of the specific action, complete_call as soon as all stated intents are resolved. Do not add a separate 'ready to finish' question or wait for goodbye.";
  let status: FreeConversationReport["status"] = "ended";
  let error: string | undefined;
  try {
    let answer = await agent.turn("", signal);
    while (true) {
      signal.throwIfAborted();
      emit({ stage: "agent", elapsed_ms: 0, detail: answer });
      await spokenRoundtrip(inference, answer, language, signal, emit, true);
      signal.throwIfAborted();
      if (agent.record) { status = "completed"; break; }
      const text = await input(signal);
      signal.throwIfAborted();
      if (text === null) break; // Ending a free conversation is not a failed test.
      const utterance = text.trim() || "[The line was silent or unintelligible. Ask me to repeat.]";
      emit({ stage: "caller", elapsed_ms: 0, detail: utterance });
      answer = await agent.turn(utterance, signal);
    }
  } catch (cause) {
    status = signal.aborted ? "cancelled" : "error";
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return { session_id: crypto.randomUUID(), mode: "free_conversation", language, reference_time: referenceTime,
    status, platform_submission: false, submission_preview: agent.record ? simulatedSubmission(agent.record).submission_preview : [],
    ...(agent.record ? { record: agent.record } : {}), transcript: agent.transcript, events,
    elapsed_ms: Math.round(performance.now() - started), ...(error ? { error } : {}) };
}
