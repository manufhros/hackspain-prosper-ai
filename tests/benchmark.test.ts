import { expect, test } from "bun:test";
import { benchmarkOptions, benchmarkPhrases, measureInference, percentiles, wordErrorRate } from "../src/voice/benchmark";
import { SharedAudio } from "../src/telephony/audio";
import { type Inference } from "../src/voice/runtime";
import { root } from "../src/data";

test("benchmark validates limits and scores transcription without punctuation/case noise", () => {
  expect(benchmarkOptions([])).toEqual({ concurrency: [1, 5, 10, 20], rounds: 3 });
  for (const args of [["--concurrency", "21"], ["--concurrency", "1,1"], ["--rounds", "0"], ["--rounds"], ["--bad", "1"]]) expect(() => benchmarkOptions(args)).toThrow();
  expect(wordErrorRate("¡Hola, clínica!", "hola clínica")).toBe(0);
  expect(wordErrorRate("hola clínica", "hola")).toBe(0.5);
  expect(percentiles([100, 10, 50, 20])).toEqual({ n: 4, p50: 20, p95: 100, max: 100 });
  expect(percentiles([]).p95).toBeNull();
});

test("synthetic capacity benchmark retains per-language scores and does not claim live capacity", async () => {
  const inference: Inference = {
    async audio(op, fields) {
      return op === "speak" ? { payload: String(fields.text), elapsed_ms: 1 } : {
        text: String(fields.payload), language: benchmarkPhrases.find(phrase => phrase.text === fields.payload)?.language, elapsed_ms: 1 };
    },
    async chat(messages) {
      const phrase = benchmarkPhrases.find(phrase => phrase.text === messages.at(-1)?.content)!;
      return { message: { role: "assistant", content: JSON.stringify({ action: phrase.action, speech: "Gracias." }) }, elapsed_ms: 1,
        metrics: { queue_ms: 0, inference_ms: 1, load_ms: 0, prompt_tokens: 10, completion_tokens: 5 } };
    }, async removeAudio() {},
  };
  const signal = new AbortController().signal;
  const report = await measureInference(inference, new SharedAudio(inference, signal, 2), { concurrency: [1, 5, 10, 20], rounds: 3 }, signal);
  expect(report.samples).toHaveLength(108);
  expect(report.samples.every(sample => sample.okay && sample.wer === 0)).toBe(true);
  expect(report.summaries.every(group => group.successful === group.attempted)).toBe(true);
  expect(report.summaries.every(group => group.by_language.every(language => language.attempted > 0))).toBe(true);
  expect(report.live_call_capacity_verified).toBe(false);
  expect(report.samples.every(sample => sample.language_correct && sample.recognized_text === sample.expected_text)).toBe(true);
  expect(report.samples[0]?.model_metrics).toMatchObject({ inference_ms: 1, load_ms: 0, prompt_tokens: 10, completion_tokens: 5 });
  expect(report.transcription_diagnostics).toHaveLength(3);
  expect(report.transcription_diagnostics.every(row => row.automatic.wer === 0 && row.explicit_language.wer === 0)).toBe(true);
});

test("benchmark exposes language detection errors even when intent passes", async () => {
  const inference: Inference = {
    async audio(op, fields) {
      if (op === "speak") return { payload: String(fields.text), elapsed_ms: 1 };
      const phrase = benchmarkPhrases.find(phrase => phrase.text === fields.payload)!;
      return { text: phrase.language === "ca" && !fields.language ? "Quiero saber cuándo abre la clínica" : phrase.text,
        language: String(fields.language ?? (phrase.language === "ca" ? "es" : phrase.language)), elapsed_ms: 1 };
    },
    async chat(messages) {
      const text = messages.at(-1)!.content;
      const action = benchmarkPhrases.find(phrase => phrase.text === text)?.action ?? "INFO";
      return { message: { role: "assistant", content: JSON.stringify({ action, speech: "Hola." }) }, elapsed_ms: 1 };
    }, async removeAudio() {},
  };
  const signal = new AbortController().signal;
  const report = await measureInference(inference, new SharedAudio(inference, signal), { concurrency: [3], rounds: 1 }, signal);
  const catalan = report.samples.find(row => row.language === "ca")!;
  expect(catalan.okay).toBe(true); expect(catalan.language_correct).toBe(false); expect(catalan.wer).toBeGreaterThan(0);
  expect(report.summaries[0]).toMatchObject({ successful: 3, exact_transcriptions: 2 });
  const diagnostic = report.transcription_diagnostics.find(row => row.language === "ca")!;
  expect(diagnostic.automatic.wer).toBeGreaterThan(0); expect(diagnostic.explicit_language.wer).toBe(0);
  expect(report.success_definition).toContain("intent only");
});

test("benchmark failures stay in denominators rather than disappearing from latency results", async () => {
  const inference: Inference = {
    async audio(op) { return op === "speak" ? { payload: "synthetic", elapsed_ms: 1 } : { text: "", elapsed_ms: 1 }; },
    async chat() { throw new Error("Synthetic overload"); }, async removeAudio() {},
  };
  const signal = new AbortController().signal;
  const report = await measureInference(inference, new SharedAudio(inference, signal), { concurrency: [5], rounds: 1 }, signal);
  expect(report.summaries[0]).toMatchObject({ attempted: 5, successful: 0, failures: 5, first_chunk_ready_ms: { n: 0, p95: null } });
});

test("benchmark help and invalid options never start services", async () => {
  for (const args of [["--help"], ["--rounds", "0"]]) {
    const child = Bun.spawn([process.execPath, "src/cli.ts", "benchmark", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [text, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(text).not.toContain("Starting an owned local stack");
    if (args[0] === "--help") { expect(code).toBe(0); expect(text).toContain("NOT 20 live calls"); }
    else { expect(code).toBe(2); expect(error).toContain("Rounds"); }
  }
});
