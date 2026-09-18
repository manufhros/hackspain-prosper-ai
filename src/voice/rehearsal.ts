import { type PublicCase, type TranscriptTurn } from "../data";
import { evaluate, type ResultInput } from "../evaluate";
import { fold, isObject } from "../validation";
import { Receptionist, type ClinicReader, type TraceEvent } from "./agent";
import { simulatedSubmission, type SubmissionPreview } from "./resolution";
import { type Inference, type Message } from "./runtime";

export interface RehearsalReport {
  platform_submission: false; submission_preview: SubmissionPreview;
  case_id: string; mode: "automated_voice" | "microphone"; reference_time: string;
  record: { actions: import("../data").Action[] }; transcript: TranscriptTurn[];
  events: TraceEvent[]; elapsed_ms: number; error?: string; limitations: string[];
  evaluation: ReturnType<typeof evaluate>;
}
export async function spokenRoundtrip(inference: Inference, text: string, language: string, signal: AbortSignal,
  event: (event: TraceEvent) => void, play = false): Promise<string> {
  const file = `${crypto.randomUUID()}.wav`;
  try {
    if (play) event({ stage: "playback", elapsed_ms: 0, detail: "Preparing and playing receptionist audio" });
    const speech = await inference.audio("speak", { text, language, file, telephone: true, play }, signal);
    event({ stage: "synthesis", elapsed_ms: speech.elapsed_ms, detail: `${language}: ${speech.duration_ms ?? 0} ms of 8 kHz mu-law roundtripped speech` });
    const heard = await inference.audio("transcribe", { file }, signal);
    event({ stage: "recognition", elapsed_ms: heard.elapsed_ms, detail: heard.text ?? "(silence)" });
    return heard.text ?? "";
  } finally { await inference.removeAudio(file); }
}
export function callerMessages(item: PublicCase): Message[] {
  // Explicit projection: never serialize the complete PublicCase or its answers.
  return [{ role: "system", content: [
    "Roleplay only the caller below in a telephone rehearsal. Follow their objectives and corrections. You cannot see clinic tools or expected answers. Give short natural spoken answers, no JSON, stage directions, tool calls, or invented personal details. Reveal details only as the persona instructs. Say goodbye when all intents are settled.",
    item.caller_prompt, `Objectives: ${item.persona.objectives.join("\n")}`, `Known caller facts: ${JSON.stringify(item.persona.data)}`,
  ].join("\n") }];
}
export async function runRehearsal(inference: Inference, clinic: ClinicReader, item: PublicCase, parent: AbortSignal,
  update: (event: TraceEvent) => void, microphone?: (agentSpeech: string, signal: AbortSignal) => Promise<string | null>): Promise<RehearsalReport> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(180000)]);
  const started = performance.now();
  const events: TraceEvent[] = [];
  const emit = (event: TraceEvent) => { events.push(event); update(event); };
  const agent = new Receptionist(inference, clinic, item.reference_time, item.language, emit);
  const caller = callerMessages(item);
  let error: string | undefined;
  try {
    let answer = await agent.turn("", signal);
    for (let turn = 0; turn <= 24; turn++) {
      emit({ stage: "agent", elapsed_ms: 0, detail: answer });
      const heard = await spokenRoundtrip(inference, answer, agent.currentLanguage, signal, emit, !!microphone);
      if (agent.record) break;
      if (turn === 24) throw new Error("Caller turn limit reached without a final record");
      let utterance: string;
      if (microphone) {
        const text = await microphone(answer, signal);
        if (text === null) throw new Error("Call cancelled by user");
        utterance = text;
        emit({ stage: "caller", elapsed_ms: 0, detail: utterance });
      } else {
        caller.push({ role: "user", content: heard || "[No audible speech. Ask the receptionist to repeat.]" });
        const response = await inference.chat(caller, [], signal);
        caller.push({ role: "assistant", content: response.message.content });
        emit({ stage: "caller", elapsed_ms: response.elapsed_ms, detail: response.message.content });
        utterance = await spokenRoundtrip(inference, response.message.content, item.language, signal, emit);
      }
      answer = await agent.turn(utterance || "[The line was silent or unintelligible. Ask me to repeat.]", signal);
    }
    if (!agent.record) error = "Caller turn limit reached without a final record";
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const record = agent.record ?? { actions: [] };
  const evaluation = evaluate(item, record, agent.transcript, item.reference_time);
  // A matching record cannot turn an interrupted/incomplete audio run into success.
  if (error) { evaluation.status = "fail"; evaluation.differences.push(`voice_run: ${error}`); }
  return { case_id: item.id, mode: microphone ? "microphone" : "automated_voice", reference_time: item.reference_time,
    platform_submission: false, submission_preview: agent.record ? simulatedSubmission(agent.record).submission_preview : [],
    record, transcript: agent.transcript, events, elapsed_ms: Math.round(performance.now() - started), error, evaluation,
    limitations: ["Local caller model, not the organiser's caller/harness.", "Serial, turn-based audio with 8 kHz mu-law conversion; no streaming or barge-in assessment.",
      "Published background-noise recordings are not included; noise cases run in clean audio.", "Clinic reads are real; final actions stay local. Simulation uses the archived case's connection time."] };
}
export function resultFromRehearsal(report: RehearsalReport): ResultInput {
  return { case_id: report.case_id, record: report.record, transcript: report.transcript, reference_time: report.reference_time,
    ...(report.error ? { execution_error: report.error } : {}) };
}
export function wordErrorRate(expected: string, actual: string): number {
  const tokenize = (s: string) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const a = tokenize(expected), b = tokenize(actual);
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return a.length ? row[b.length]! / a.length : b.length ? 1 : 0;
}
export async function voiceSmoke(inference: Inference, signal: AbortSignal, update: (event: TraceEvent) => void) {
  const samples = [
    { language: "en", text: "Hello, I would like an appointment on Thursday morning." },
    { language: "es", text: "Hola, quiero una cita el jueves por la mañana." },
    { language: "ca", text: "Hola, voldria una visita dijous al matí." },
  ];
  const results = [];
  for (const sample of samples) {
    const heard = await spokenRoundtrip(inference, sample.text, sample.language, signal, update);
    results.push({ ...sample, heard, word_error_rate: wordErrorRate(sample.text, heard) });
  }
  const reply = await inference.chat([{ role: "user", content: "Return JSON with ready=true and languages=[en,es,ca]." }], [], signal,
    { type: "object", properties: { ready: { type: "boolean" }, languages: { type: "array", items: { type: "string" } } }, required: ["ready", "languages"] });
  const data: unknown = JSON.parse(reply.message.content);
  return { label: "Local speech/model smoke test, not scheduling performance", speech: results, model_ms: reply.elapsed_ms,
    model_ready: isObject(data) && data.ready === true, thresholds: "WER is diagnostic; no arbitrary pass threshold. Listen to assess quality." };
}
