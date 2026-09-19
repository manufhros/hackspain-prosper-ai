import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readJson, saveLocal, stateDir } from "../storage";
import { isObject } from "../validation";
import { percentiles, wordErrorCounts } from "./benchmark";
import { LocalRuntime, voiceDir, type Inference } from "./runtime";
import { localSettings } from "./settings";

const languages = ["en", "es", "ca"];
const channels = ["clean", "telephone"] as const;
const hash = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
interface Clip {
  id: string; language: string; reference: string; clean_file: string; clean_sha256: string;
  wire_payload: string; wire_sha256: string; duration_ms: number;
}
interface Sample {
  id: string; language: string; channel: string; reference: string; recognized: string;
  detected_language?: string; decoder?: string; elapsed_ms?: number; error?: string; errors: number; words: number; wer: number;
}
export function recognitionOptions(args: string[]) {
  if (!args.length) return { manifest: join(stateDir, "human-speech/manifest.json") };
  if (args.length === 2 && args[0] === "--manifest" && args[1]) return { manifest: resolve(args[1]) };
  throw new Error("Use bun run benchmark:asr [--manifest path] or --help");
}
export function validateRecognitionCorpus(value: unknown) {
  if (!isObject(value) || value.version !== 1 || value.source !== "google/fleurs" || value.license !== "CC-BY-4.0"
    || typeof value.revision !== "string" || !/^[a-f0-9]{40}$/.test(value.revision)
    || !Array.isArray(value.clips) || !value.clips.length || value.clips.length > 300)
    throw new Error("Invalid FLEURS corpus manifest");
  const ids = new Set<string>();
  const clips: Clip[] = value.clips.map(row => {
    if (!isObject(row) || typeof row.id !== "string" || !/^(en|es|ca)-\d{1,30}$/.test(row.id) || ids.has(row.id)
      || typeof row.language !== "string" || !languages.includes(row.language) || !row.id.startsWith(row.language + "-")
      || row.clean_file !== `${row.id}.wav` || typeof row.clean_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.clean_sha256)
      || typeof row.reference !== "string" || !row.reference.trim() || row.reference.length > 2000
      || typeof row.duration_ms !== "number" || row.duration_ms < 1000 || row.duration_ms > 20000
      || typeof row.wire_payload !== "string" || !row.wire_payload || row.wire_payload.length > 320000)
      throw new Error("Invalid FLEURS clip metadata");
    const bytes = Buffer.from(row.wire_payload, "base64");
    if (bytes.toString("base64") !== row.wire_payload || row.wire_sha256 !== hash(bytes) || Math.abs(bytes.length / 8 - row.duration_ms) > 1)
      throw new Error("FLEURS telephone audio checksum mismatch");
    ids.add(row.id);
    return { id: row.id, language: row.language, reference: row.reference, duration_ms: row.duration_ms,
      clean_file: String(row.clean_file), clean_sha256: row.clean_sha256, wire_payload: row.wire_payload, wire_sha256: String(row.wire_sha256) };
  });
  return { source: value.source, revision: value.revision, license: value.license,
    selection: typeof value.selection === "string" ? value.selection.slice(0, 1000) : "Caller-supplied subset; see inputs",
    source_url: "https://huggingface.co/datasets/google/fleurs", license_url: "https://creativecommons.org/licenses/by/4.0/", clips };
}
export async function measureRecognition(inference: Pick<Inference, "audio">, clips: Clip[], signal: AbortSignal, progress: (message: string) => void = () => {}) {
  const samples: Sample[] = [];
  let previousLanguage = "";
  for (const clip of clips) for (const channel of channels) {
    signal.throwIfAborted();
    if (previousLanguage !== clip.language) { progress(`Recognizing ${clip.language} recordings…`); previousLanguage = clip.language; }
    const sample: Sample = { id: clip.id, language: clip.language, channel, reference: clip.reference,
      recognized: "", errors: 0, words: 0, wer: 0 };
    try {
      // References and language labels are scoring data only: never sent to ASR.
      const reply = await inference.audio(channel === "clean" ? "transcribe" : "transcribe_mulaw",
        channel === "clean" ? { file: clip.clean_file } : { payload: clip.wire_payload },
        AbortSignal.any([signal, AbortSignal.timeout(60000)]));
      sample.recognized = reply.text ?? ""; sample.detected_language = reply.language;
      sample.decoder = reply.decoder; sample.elapsed_ms = reply.elapsed_ms;
    } catch (error) {
      signal.throwIfAborted();
      sample.error = error instanceof Error ? error.message : String(error);
    }
    Object.assign(sample, wordErrorCounts(clip.reference, sample.recognized));
    sample.wer = sample.errors / Math.max(1, sample.words); samples.push(sample);
  }
  const summaries = languages.flatMap(language => channels.map(channel => {
    const rows = samples.filter(row => row.language === language && row.channel === channel);
    const errors = rows.reduce((sum, row) => sum + row.errors, 0), words = rows.reduce((sum, row) => sum + row.words, 0);
    return { language, channel, attempted: rows.length, failures: rows.filter(row => row.error).length,
      language_correct: rows.filter(row => row.detected_language === language).length,
      exact_transcriptions: rows.filter(row => !row.error && row.errors === 0).length,
      word_errors: errors, reference_words: words, corpus_wer: words ? errors / words : null,
      worker_ms: percentiles(rows.flatMap(row => row.elapsed_ms === undefined ? [] : [row.elapsed_ms])) };
  }));
  return { summaries, samples };
}

export async function runRecognitionCheck(args: string[]) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    console.log(`Human-recorded ASR comparison; starts recognition workers only when invoked.
bun run benchmark:asr [--manifest path]
Compares small/turbo × transcribe/segment on original 16 kHz and 8 kHz mu-law audio.
No Qwen, Piper, cloud inference, clinic requests or submissions. Stop other voice stacks first.
Prepare the fixed FLEURS subset (downloads/codec conversion only, no models):
.workbench/voice/venv/bin/python scripts/prepare-human-speech.py
This is a small read-speech sample, not clinical accuracy or concurrent-call capacity proof.
Reports corpus WER, language accuracy and isolated worker timing; references never enter ASR.`);
    return;
  }
  const { manifest } = recognitionOptions(args), corpus = validateRecognitionCorpus(await readJson(manifest));
  // Verify every local source before starting inference or copying into the private audio directory.
  for (const clip of corpus.clips) {
    const file = Bun.file(join(dirname(manifest), clip.clean_file));
    if (!await file.exists() || file.size > 2 * 1024 * 1024 || hash(new Uint8Array(await file.arrayBuffer())) !== clip.clean_sha256)
      throw new Error(`FLEURS clean audio missing or checksum mismatch: ${clip.id}`);
  }
  const lifetime = new AbortController(), staged: string[] = [];
  let runtime: LocalRuntime | undefined;
  const stop = () => { lifetime.abort(new Error("Recognition check cancelled")); runtime?.stop(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop); process.once("SIGHUP", stop);
  const profiles = [];
  try {
    await mkdir(join(voiceDir, "audio"), { recursive: true, mode: 0o700 });
    const clips: Clip[] = [];
    for (const clip of corpus.clips) {
      const name = `quality-${crypto.randomUUID()}.wav`, path = join(voiceDir, "audio", name);
      staged.push(path); await Bun.write(path, Bun.file(join(dirname(manifest), clip.clean_file))); await chmod(path, 0o600);
      clips.push({ ...clip, clean_file: name });
    }
    for (const asrModel of ["small", "large-v3-turbo"] as const) for (const asrDecoder of ["transcribe", "segment"] as const) {
      lifetime.signal.throwIfAborted();
      const settings = { ...localSettings(), asrModel, asrDecoder };
      runtime = new LocalRuntime(console.log, { recognitionOnly: true, settings });
      try {
        console.log(`Checking ${asrModel}/${asrDecoder} on ${clips.length} human recordings, two audio formats…`);
        await runtime.start();
        const measured = await measureRecognition(runtime, clips, lifetime.signal, console.log);
        profiles.push({ asrModel, asrDecoder, ...measured });
        console.log(JSON.stringify(measured.summaries, null, 2));
      } finally { runtime.stop(); }
    }
    const { clips: inputs, ...attribution } = corpus;
    const file = await saveLocal(`recognition-${Date.now()}.json`, { ...attribution,
      input_sha256: hash(JSON.stringify(inputs)), inputs: inputs.map(({ wire_payload, ...clip }) => clip), profiles,
      live_call_capacity_verified: false, clinical_accuracy_verified: false,
      measurement: "Serial, warmed ASR only; original mono 16 kHz PCM16 vs resampled 8 kHz mu-law; no language hint or transcript prompt. WER normalizes case/punctuation with NFKC. Failures count as empty transcripts in corpus WER." });
    console.log(`Saved: ${file}`);
    if (profiles.some(profile => profile.samples.some(sample => sample.error))) process.exitCode = 1;
  } finally {
    stop(); process.off("SIGINT", stop); process.off("SIGTERM", stop); process.off("SIGHUP", stop);
    await Promise.all(staged.map(path => rm(path, { force: true })));
  }
}
