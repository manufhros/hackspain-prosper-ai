import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchmarkInputs, benchmarkInputEvidence, validateBenchmarkInputs } from "../src/voice/benchmark-inputs";
import { benchmarkPhrases, measureInference } from "../src/voice/benchmark";
import { SharedAudio } from "../src/telephony/audio";
import { type Inference } from "../src/voice/runtime";

const signal = () => new AbortController().signal;

test("benchmark caches exact synthetic input bytes across runs and detects changed/corrupt inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-input-test-"));
  let generated = 0;
  const audio = { async run() { return { elapsed_ms: 1, payload: Buffer.alloc(8000, ++generated).toString("base64") }; } };
  try {
    const first = await benchmarkInputs(audio, signal(), directory);
    const second = await benchmarkInputs({ async run() { throw new Error("Must not regenerate inputs"); } }, signal(), directory);
    expect(generated).toBe(3);
    expect(first).toEqual(second);
    expect(benchmarkInputEvidence(first)).toEqual(benchmarkInputEvidence(second));
    expect(benchmarkInputEvidence(first).recordings.every(row => row.duration_ms === 1000)).toBe(true);
    expect(benchmarkInputEvidence(first).recordings[0]).not.toHaveProperty("payload");
    const changed = structuredClone(first);
    changed.recordings[0]!.payload = Buffer.alloc(8000, 7).toString("base64");
    expect(() => validateBenchmarkInputs(changed)).toThrow("checksum");
    changed.recordings[0]!.sha256 = new Bun.CryptoHasher("sha256").update(Buffer.alloc(8000, 7)).digest("hex");
    expect(benchmarkInputEvidence(validateBenchmarkInputs(changed)).sha256).not.toBe(benchmarkInputEvidence(first).sha256);
    for (const mutate of [
      (v: typeof first) => { v.recordings[0]!.text = "A different phrase"; },
      (v: typeof first) => { v.recordings[0]!.payload = "!bad"; },
      (v: typeof first) => { v.recordings[0]!.payload = "a".repeat(320004); },
      (v: typeof first) => { v.recordings.pop(); },
    ]) {
      const invalid = structuredClone(first); mutate(invalid);
      expect(() => validateBenchmarkInputs(invalid)).toThrow();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("fixed benchmark inputs reach both diagnostics and timed ASR without new source synthesis", async () => {
  let outputSyntheses = 0;
  const heard: string[] = [];
  const recordings = benchmarkPhrases.map(phrase => `fixed-${phrase.language}`);
  const inference: Inference = {
    async audio(op, fields) {
      if (op === "speak") {
        expect(fields.text).toBe("Next detail?"); outputSyntheses++;
        return { elapsed_ms: 1, payload: "response" };
      }
      const payload = String(fields.payload); heard.push(payload);
      const phrase = benchmarkPhrases[recordings.indexOf(payload)]!;
      return { elapsed_ms: 1, text: phrase.text, language: phrase.language };
    },
    async chat(messages) {
      const phrase = benchmarkPhrases.find(row => row.text === messages.at(-1)?.content)!;
      return { elapsed_ms: 1, message: { role: "assistant", content: JSON.stringify({ action: phrase.action, speech: "Next detail?" }) } };
    }, async removeAudio() {},
  };
  const lifetime = signal();
  const report = await measureInference(inference, new SharedAudio(inference, lifetime), { concurrency: [3], rounds: 1 }, lifetime, () => {}, recordings);
  expect(report.samples.every(sample => sample.okay && sample.wer === 0)).toBe(true);
  expect(outputSyntheses).toBe(3);
  for (const recording of recordings) expect(heard.filter(payload => payload === recording)).toHaveLength(3);
});
