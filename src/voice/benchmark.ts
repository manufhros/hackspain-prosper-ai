import { SharedAudio } from "../telephony/audio";
import { speechChunks } from "../telephony/speech";
import { saveLocal } from "../storage";
import { isObject } from "../validation";
import { modelConfig } from "./model";
import { LocalRuntime, type Inference } from "./runtime";

export const benchmarkHelp = `Local inference capacity benchmark (synthetic speech; no clinic API or submissions)

bun run benchmark                         Start local models; test 1,5,10,20 concurrent turns, 3 rounds
bun run benchmark --concurrency 1,5 --rounds 2
bun run benchmark --help                   No startup

Quit the TUI/server first: this command owns its own local inference processes.
Requires LLM_PROVIDER=local. LOCAL_* settings select capacity and ASR model.
Setup may download dependencies/models. Ctrl-C stops owned processes.
Reports .workbench/benchmark-*.json with worker/queue timings, WER and intent accuracy.
These are synchronized synthetic ASR → intent extraction → TTS jobs, NOT 20 live calls.
No endpointing, paced playback, clinic tools, consent, background noise or human accents
are exercised. Use actual platform calls and their reports to validate those separately.
`;
export function benchmarkOptions(args: string[]) {
  let concurrency = [1, 5, 10, 20], rounds = 3;
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === "--concurrency" && /^\d+(,\d+)*$/.test(value)) concurrency = value.split(",").map(Number);
    else if (key === "--rounds" && /^\d+$/.test(value)) rounds = Number(value);
    else throw new Error(`Invalid benchmark option: ${key}`);
  }
  if (concurrency.length > 8 || concurrency.some(n => n < 1 || n > 20) || new Set(concurrency).size !== concurrency.length) throw new Error("Concurrency must contain distinct values from 1–20");
  if (rounds < 1 || rounds > 20) throw new Error("Rounds must be 1–20");
  return { concurrency, rounds };
}
export const benchmarkPhrases = [
  { language: "en", action: "BOOK", text: "I would like to book an appointment next Tuesday morning." },
  { language: "es", action: "CANCEL", text: "Quiero cancelar mi cita del próximo martes por la mañana." },
  { language: "ca", action: "INFO", text: "Voldria saber a quina hora obre la clínica els dilluns." },
] as const;
export function wordErrorRate(expected: string, actual: string): number {
  const words = (text: string) => text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const a = words(expected), b = words(actual);
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]! / Math.max(1, a.length);
}
export function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]! : null;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}
const schema = { type: "object", properties: { action: { type: "string", enum: ["BOOK", "CANCEL", "INFO"] },
  speech: { type: "string" } }, required: ["action", "speech"], additionalProperties: false };
export interface BenchmarkSample {
  concurrency: number; round: number; language: string; okay: boolean; error?: string;
  wer?: number; intent_correct?: boolean; first_chunk_ready_ms?: number; total_ms?: number;
  asr_ms?: number; asr_queue_ms?: number; model_ms?: number; model_queue_ms?: number;
  prefill_ms?: number; decode_ms?: number; tts_ms?: number; tts_queue_ms?: number;
}
export async function measureInference(inference: Inference, audio: SharedAudio, options: ReturnType<typeof benchmarkOptions>,
  signal: AbortSignal, progress: (message: string) => void = () => {}) {
  const samples: BenchmarkSample[] = [], recordings: string[] = [];
  progress("Preparing synthetic English, Spanish and Catalan telephone audio; warmup excluded.");
  for (const phrase of benchmarkPhrases) {
    const speech = await audio.run("speak", { text: phrase.text, language: phrase.language, wire: true }, signal);
    if (!speech.payload) throw new Error("Benchmark source synthesis returned no audio");
    recordings.push(speech.payload);
    await audio.run("transcribe_mulaw", { payload: speech.payload }, signal);
  }
  for (const concurrency of options.concurrency) {
    for (let round = 0; round < options.rounds; round++) {
      signal.throwIfAborted();
      progress(`${concurrency} simultaneous turns · round ${round + 1}/${options.rounds}`);
      await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
        const phraseIndex = (round + index) % benchmarkPhrases.length, phrase = benchmarkPhrases[phraseIndex]!;
        const sample: BenchmarkSample = { concurrency, round: round + 1, language: phrase.language, okay: false };
        const started = performance.now();
        const turnSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
        try {
          const heard = await audio.run("transcribe_mulaw", { payload: recordings[phraseIndex]! }, turnSignal);
          sample.asr_ms = heard.elapsed_ms; sample.asr_queue_ms = heard.queue_ms ?? 0;
          sample.wer = wordErrorRate(phrase.text, heard.text ?? "");
          const reply = await inference.chat([
            { role: "system", content: `Classify the caller intent as BOOK, CANCEL, or INFO. Return JSON with action and speech. Speech must be one short question in ${phrase.language}, asking for the next needed detail. Do not claim any action has been performed.` },
            { role: "user", content: heard.text ?? "" },
          ], [], turnSignal, schema);
          sample.model_ms = reply.elapsed_ms;
          for (const [key, target] of [["queue_ms", "model_queue_ms"], ["prefill_ms", "prefill_ms"], ["decode_ms", "decode_ms"]] as const) {
            const value = reply.metrics?.[key]; if (typeof value === "number") sample[target] = value;
          }
          const result: unknown = JSON.parse(reply.message.content);
          if (!isObject(result) || !["BOOK", "CANCEL", "INFO"].includes(String(result.action)) || typeof result.speech !== "string" || !result.speech.trim() || result.speech.length > 500) throw new Error("Malformed benchmark intent response");
          sample.intent_correct = result.action === phrase.action;
          sample.tts_ms = 0; sample.tts_queue_ms = 0;
          // Synthesis work only; no artificial playback delay hides native queue pressure.
          for (const chunk of speechChunks(result.speech)) {
            const speech = await audio.run("speak", { text: chunk, language: phrase.language, wire: true }, turnSignal);
            if (!speech.payload) throw new Error("Benchmark reply synthesis returned no audio");
            sample.first_chunk_ready_ms ??= Math.round(performance.now() - started);
            sample.tts_ms += speech.elapsed_ms; sample.tts_queue_ms += speech.queue_ms ?? 0;
          }
          sample.okay = sample.intent_correct;
        } catch (error) { sample.error = error instanceof Error ? error.message : String(error); }
        sample.total_ms = Math.round(performance.now() - started); samples.push(sample);
      }));
    }
  }
  const summaries = options.concurrency.map(concurrency => {
    const group = samples.filter(sample => sample.concurrency === concurrency);
    return { concurrency, attempted: group.length, successful: group.filter(sample => sample.okay).length,
      failures: group.filter(sample => sample.error).length,
      first_chunk_ready_ms: percentiles(group.flatMap(sample => sample.first_chunk_ready_ms === undefined ? [] : [sample.first_chunk_ready_ms])),
      stage_ms: Object.fromEntries((["asr_ms", "asr_queue_ms", "model_ms", "model_queue_ms", "prefill_ms", "decode_ms", "tts_ms", "tts_queue_ms"] as const)
        .map(key => [key, percentiles(group.flatMap(sample => sample[key] === undefined ? [] : [sample[key]!]))])),
      by_language: benchmarkPhrases.map(({ language }) => {
        const rows = group.filter(sample => sample.language === language), scored = rows.filter(sample => sample.wer !== undefined);
        return { language, attempted: rows.length, intent_correct: rows.filter(sample => sample.intent_correct).length,
          mean_wer: scored.length ? scored.reduce((sum, sample) => sum + sample.wer!, 0) / scored.length : null };
      }) };
  });
  return { input_source: "synthetic_piper_8khz_mulaw", live_call_capacity_verified: false,
    latency_definition: "Complete input audio queued to first synthesized response chunk; excludes VAD, transport and playback",
    summaries, samples };
}
export async function runBenchmark(args: string[]) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) { console.log(benchmarkHelp); return; }
  const options = benchmarkOptions(args);
  if (modelConfig().provider !== "local") throw new Error("Benchmark requires LLM_PROVIDER=local; no external model requests are allowed");
  const lifetime = new AbortController(), runtime = new LocalRuntime(message => console.log(message));
  const stop = () => { lifetime.abort(new Error("Benchmark cancelled")); runtime.stop(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop); process.once("SIGHUP", stop);
  try {
    console.log("Starting an owned local stack for the benchmark. Keep other voice servers/TUIs stopped.");
    await runtime.start();
    const report = await measureInference(runtime, new SharedAudio(runtime, lifetime.signal, runtime.settings.ttsWorkers), options, lifetime.signal, console.log);
    const file = await saveLocal(`benchmark-${Date.now()}.json`, { ...report, settings: runtime.settings, model: runtime.modelLabel });
    console.log(JSON.stringify(report.summaries, null, 2)); console.log(`Saved: ${file}`);
    if (report.samples.some(sample => !sample.okay)) process.exitCode = 1;
  } finally { stop(); process.off("SIGINT", stop); process.off("SIGTERM", stop); process.off("SIGHUP", stop); }
}
