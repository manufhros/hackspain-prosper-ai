import { join } from "node:path";
import { readJson, saveLocal, stateDir } from "../storage";
import { isObject } from "../validation";
import { type SharedAudio } from "../telephony/audio";

export const benchmarkPhrases = [
  { language: "en", action: "BOOK", text: "I would like to book an appointment next Tuesday morning." },
  { language: "es", action: "CANCEL", text: "Quiero cancelar mi cita del próximo martes por la mañana." },
  { language: "ca", action: "INFO", text: "Voldria saber a quina hora obre la clínica els dilluns." },
] as const;
const filename = "benchmark-inputs-v1.json";
const source = "synthetic_piper_8khz_mulaw";
const hash = (value: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
interface Recording { language: string; action: string; text: string; payload: string; sha256: string }
interface Inputs { version: number; source: string; recordings: Recording[] }

function recording(phrase: typeof benchmarkPhrases[number], payload: unknown): Recording {
  if (typeof payload !== "string" || !payload || payload.length > 320000)
    throw new Error("Benchmark input must be nonempty mu-law audio up to 30 seconds");
  const bytes = Buffer.from(payload, "base64");
  if (!bytes.length || bytes.toString("base64") !== payload)
    throw new Error("Benchmark input is not canonical base64 audio");
  return { ...phrase, payload, sha256: hash(bytes) };
}

export function validateBenchmarkInputs(value: unknown): Inputs {
  if (!isObject(value) || value.version !== 1 || value.source !== source || !Array.isArray(value.recordings)
    || value.recordings.length !== benchmarkPhrases.length) throw new Error("Incompatible benchmark inputs");
  const rows = value.recordings;
  const recordings = benchmarkPhrases.map((phrase, index) => {
    const row = rows[index];
    if (!isObject(row) || row.text !== phrase.text || row.language !== phrase.language || row.action !== phrase.action)
      throw new Error("Benchmark input phrases do not match this benchmark");
    const checked = recording(phrase, row.payload);
    if (row.sha256 !== checked.sha256) throw new Error("Benchmark input checksum mismatch");
    return checked;
  });
  return { version: 1, source, recordings };
}

/** Persist only the fixed public phrases, never call audio. Reuse exact bytes across profiles. */
export async function benchmarkInputs(audio: Pick<SharedAudio, "run">, signal: AbortSignal, directory = stateDir): Promise<Inputs> {
  signal.throwIfAborted();
  const path = join(directory, filename);
  if (await Bun.file(path).exists()) return validateBenchmarkInputs(await readJson(path));
  const recordings: Recording[] = [];
  for (const phrase of benchmarkPhrases) {
    const speech = await audio.run("speak", { text: phrase.text, language: phrase.language, wire: true }, signal);
    recordings.push(recording(phrase, speech.payload));
  }
  signal.throwIfAborted();
  const inputs = { version: 1, source, recordings };
  await saveLocal(filename, inputs, directory);
  return inputs;
}

export function benchmarkInputEvidence(inputs: Inputs) {
  const recordings = inputs.recordings.map(({ payload, ...row }) => ({ ...row, duration_ms: Buffer.from(payload, "base64").length / 8 }));
  return { sha256: hash(JSON.stringify({ version: inputs.version, source: inputs.source, recordings })), recordings };
}
