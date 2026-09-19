import { SharedAudio } from "../telephony/audio";
import { speechChunks } from "../telephony/speech";
import { saveLocal } from "../storage";
import { isObject } from "../validation";
import { modelConfig } from "./model";
import { LocalRuntime, type Inference } from "./runtime";
import { benchmarkInputEvidence, benchmarkInputs, benchmarkPhrases } from "./benchmark-inputs";
export { benchmarkPhrases } from "./benchmark-inputs";

export const benchmarkHelp = `Inference capacity benchmark (synthetic speech; no clinic API or submissions)

bun run benchmark                         Start local models; test 1,5,10,20 concurrent turns, 3 rounds
bun run benchmark --concurrency 1,5 --rounds 2
bun run benchmark --help                   No startup

Quit the TUI/server first: this command owns its own local inference processes.
Requires LLM_PROVIDER=local. ASR_PROVIDER=local (default) or openrouter selects recognition.
OpenRouter ASR sends audio externally and incurs usage charges; routing is provider-managed.
LOCAL_* settings select local capacity and Whisper model when ASR_PROVIDER=local.
Setup may download dependencies/models. Ctrl-C stops owned processes.
Reports .workbench/benchmark-*.json with worker/queue timings, WER and intent accuracy.
Reuses fixed audio from .workbench/benchmark-inputs-v1.json; reports include input hashes.
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
export function wordErrorCounts(expected: string, actual: string) {
  const words = (text: string) => text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const a = words(expected), b = words(actual);
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return { errors: row[b.length]!, words: a.length };
}
export function wordErrorRate(expected: string, actual: string): number {
  const { errors, words } = wordErrorCounts(expected, actual);
  return errors / Math.max(1, words);
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
  expected_text: string; recognized_text?: string; detected_language?: string; language_correct?: boolean;
  model_metrics?: Record<string, number | string>;
  asr_metrics?: Record<string, number | string>;
  wer?: number; intent_correct?: boolean; first_chunk_ready_ms?: number; total_ms?: number;
  asr_ms?: number; asr_queue_ms?: number; asr_decoder?: string; model_ms?: number; model_queue_ms?: number;
  prefill_ms?: number; decode_ms?: number; tts_ms?: number; tts_queue_ms?: number;
}
export async function measureInference(inference: Inference, audio: SharedAudio, options: ReturnType<typeof benchmarkOptions>,
  signal: AbortSignal, progress: (message: string) => void = () => {}, fixedRecordings?: readonly string[]) {
  if (fixedRecordings && fixedRecordings.length !== benchmarkPhrases.length) throw new Error("Benchmark requires one recording per phrase");
  const samples: BenchmarkSample[] = [], recordings: string[] = [];
  const transcriptionDiagnostics = [];
  progress("Preparing synthetic English, Spanish and Catalan telephone audio; warmup excluded.");
  for (const [index, phrase] of benchmarkPhrases.entries()) {
    const payload = fixedRecordings?.[index] ?? (await audio.run("speak", { text: phrase.text, language: phrase.language, wire: true }, signal)).payload;
    if (!payload) throw new Error("Benchmark source synthesis returned no audio");
    recordings.push(payload);
    // Compare detection and recognition separately, outside measured batches. These
    // known-language hints are diagnostic only; real calls still allow language switches.
    const automatic = await audio.run("transcribe_mulaw", { payload }, signal);
    const hinted = await audio.run("transcribe_mulaw", { payload, language: phrase.language }, signal);
    const score = (heard: typeof automatic) => ({ recognized_text: heard.text ?? "", detected_language: heard.language ?? null,
      wer: wordErrorRate(phrase.text, heard.text ?? ""), elapsed_ms: heard.elapsed_ms, decoder: heard.decoder, metrics: heard.metrics });
    transcriptionDiagnostics.push({ language: phrase.language, expected_text: phrase.text, automatic: score(automatic), explicit_language: score(hinted) });
  }
  for (const concurrency of options.concurrency) {
    for (let round = 0; round < options.rounds; round++) {
      signal.throwIfAborted();
      progress(`${concurrency} simultaneous turns · round ${round + 1}/${options.rounds}`);
      await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
        const phraseIndex = (round + index) % benchmarkPhrases.length, phrase = benchmarkPhrases[phraseIndex]!;
        const sample: BenchmarkSample = { concurrency, round: round + 1, language: phrase.language, expected_text: phrase.text, okay: false };
        const started = performance.now();
        const turnSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
        try {
          const heard = await audio.run("transcribe_mulaw", { payload: recordings[phraseIndex]! }, turnSignal);
          sample.asr_ms = heard.elapsed_ms; sample.asr_queue_ms = heard.queue_ms ?? 0;
          sample.asr_decoder = heard.decoder; sample.asr_metrics = heard.metrics;
          sample.recognized_text = heard.text ?? ""; sample.detected_language = heard.language;
          sample.language_correct = heard.language === phrase.language;
          sample.wer = wordErrorRate(phrase.text, heard.text ?? "");
          const reply = await inference.chat([
            { role: "system", content: `Classify the caller intent as BOOK, CANCEL, or INFO. Return JSON with action and speech. Speech must be one short question in ${phrase.language}, asking for the next needed detail. Do not claim any action has been performed.` },
            { role: "user", content: heard.text ?? "" },
          ], [], turnSignal, schema);
          sample.model_ms = reply.elapsed_ms;
          sample.model_metrics = reply.metrics;
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
      exact_transcriptions: group.filter(sample => sample.wer === 0).length,
      failures: group.filter(sample => sample.error).length,
      first_chunk_ready_ms: percentiles(group.flatMap(sample => sample.first_chunk_ready_ms === undefined ? [] : [sample.first_chunk_ready_ms])),
      stage_ms: Object.fromEntries((["asr_ms", "asr_queue_ms", "model_ms", "model_queue_ms", "prefill_ms", "decode_ms", "tts_ms", "tts_queue_ms"] as const)
        .map(key => [key, percentiles(group.flatMap(sample => sample[key] === undefined ? [] : [sample[key]!]))])),
      by_language: benchmarkPhrases.map(({ language }) => {
        const rows = group.filter(sample => sample.language === language), scored = rows.filter(sample => sample.wer !== undefined);
        return { language, attempted: rows.length, intent_correct: rows.filter(sample => sample.intent_correct).length,
          language_correct: rows.filter(sample => sample.language_correct).length,
          exact_transcriptions: rows.filter(sample => sample.wer === 0).length,
          mean_wer: scored.length ? scored.reduce((sum, sample) => sum + sample.wer!, 0) / scored.length : null };
      }) };
  });
  return { input_source: "synthetic_piper_8khz_mulaw", live_call_capacity_verified: false,
    success_definition: "okay/successful count completed jobs with correct intent only; transcription and language accuracy are scored separately",
    latency_definition: "Complete input audio queued to first synthesized response chunk; excludes VAD, transport and playback",
    transcription_diagnostics: transcriptionDiagnostics, summaries, samples };
}
export async function runBenchmark(args: string[]) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) { console.log(benchmarkHelp); return; }
  const options = benchmarkOptions(args);
  if (modelConfig().provider !== "local") throw new Error("Benchmark requires LLM_PROVIDER=local; ASR_PROVIDER independently selects local or hosted transcription");
  const lifetime = new AbortController(), runtime = new LocalRuntime(message => console.log(message));
  const stop = () => { lifetime.abort(new Error("Benchmark cancelled")); runtime.stop(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop); process.once("SIGHUP", stop);
  try {
    console.log("Starting the benchmark stack. Keep other voice servers/TUIs stopped.");
    await runtime.start();
    const audio = new SharedAudio(runtime, lifetime.signal, runtime.settings.ttsWorkers);
    const inputs = await benchmarkInputs(audio, lifetime.signal);
    const evidence = benchmarkInputEvidence(inputs);
    console.log(`Fixed input audio SHA-256: ${evidence.sha256}`);
    const report = await measureInference(runtime, audio, options, lifetime.signal, console.log, inputs.recordings.map(row => row.payload));
    const file = await saveLocal(`benchmark-${Date.now()}.json`, { ...report, input_audio: evidence, settings: runtime.settings, transcription: runtime.transcription, model: runtime.modelLabel, model_runtime: runtime.modelRuntime });
    console.log(JSON.stringify(report.summaries, null, 2)); console.log(`Saved: ${file}`);
    if (report.samples.some(sample => sample.wer !== undefined && sample.wer > 0))
      console.log("Transcription errors detected; inspect recognized_text and transcription_diagnostics even when intent is correct.");
    if (report.samples.some(sample => !sample.okay)) process.exitCode = 1;
  } finally { stop(); process.off("SIGINT", stop); process.off("SIGTERM", stop); process.off("SIGHUP", stop); }
}
