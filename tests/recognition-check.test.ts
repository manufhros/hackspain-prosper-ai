import { expect, test } from "bun:test";
import { measureRecognition, recognitionOptions, validateRecognitionCorpus } from "../src/voice/recognition-check";
import { root } from "../src/data";

const signal = () => new AbortController().signal;
function clip(id: string, reference: string) {
  const bytes = Buffer.alloc(8000, 255);
  return { id, language: id.slice(0, 2), reference, clean_file: `${id}.wav`, clean_sha256: "0".repeat(64),
    wire_payload: bytes.toString("base64"), wire_sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), duration_ms: 1000 };
}
const manifest = () => ({ version: 1, source: "google/fleurs", revision: "0".repeat(40), license: "CC-BY-4.0", clips: [clip("ca-1", "Hola clínica")] });

test("human speech corpus validates paths, payload hashes, durations and duplicate IDs before startup", () => {
  expect(validateRecognitionCorpus(manifest()).clips[0]?.language).toBe("ca");
  for (const update of [
    (value: ReturnType<typeof manifest>) => { value.clips[0]!.clean_file = "../private.wav"; },
    (value: ReturnType<typeof manifest>) => { value.clips[0]!.wire_sha256 = "bad"; },
    (value: ReturnType<typeof manifest>) => { value.clips[0]!.duration_ms = 2000; },
    (value: ReturnType<typeof manifest>) => { value.clips.push(value.clips[0]!); },
    (value: ReturnType<typeof manifest>) => { value.clips[0]!.reference = ""; },
  ]) {
    const value = manifest(); update(value); expect(() => validateRecognitionCorpus(value)).toThrow();
  }
  expect(() => recognitionOptions(["--unknown"])).toThrow();
});

test("ASR quality scoring keeps references out of inference and weights word errors by reference length", async () => {
  const clips = [clip("en-1", "one two three four"), clip("en-2", "hello")];
  let index = 0;
  const report = await measureRecognition({ async audio(op, fields) {
    expect(fields).not.toHaveProperty("language"); expect(fields).not.toHaveProperty("reference");
    expect(fields).not.toHaveProperty("prompt");
    if (op === "transcribe") expect(Object.keys(fields)).toEqual(["file"]);
    else { expect(op).toBe("transcribe_mulaw"); expect(Object.keys(fields)).toEqual(["payload"]); }
    if (++index > 2) throw new Error("Synthetic failure");
    return { text: "one two", language: "en", decoder: "segment", elapsed_ms: 10 };
  } }, clips, signal());
  for (const channel of ["clean", "telephone"]) {
    expect(report.summaries.find(row => row.language === "en" && row.channel === channel))
      .toMatchObject({ attempted: 2, failures: 1, word_errors: 3, reference_words: 5, corpus_wer: 0.6, worker_ms: { n: 1, p50: 10 } });
  }
  expect(report.samples).toHaveLength(4);
  expect(report.samples[2]?.recognized).toBe("");
});


test("ASR command help and invalid options never start recognition workers", async () => {
  for (const args of [["--help"], ["--bad"]]) {
    const child = Bun.spawn([process.execPath, "src/cli.ts", "benchmark-asr", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stdout).not.toContain("Checking small/"); expect(stdout).not.toContain("Model:");
    if (args[0] === "--help") { expect(code).toBe(0); expect(stdout).toContain("No Qwen, Piper"); }
    else { expect(code).toBe(2); expect(stderr).toContain("Use bun run benchmark:asr"); }
  }
});
