import { expect, test } from "bun:test";
import { microphoneInput, RECORDING_LIMIT_MS } from "../src/voice/microphone";
import { type AudioReply } from "../src/voice/runtime";

function fixture(choices: (string | null)[], texts: (string | null)[] = [], transcripts = ["Hola, una cita."]) {
  const operations: { operation: string; fields: Record<string, unknown>; aborted: boolean }[] = [];
  const removed: string[] = [], messages: string[] = [], timeouts: (number | undefined)[] = [];
  const abort = new AbortController();
  const inference = {
    async audio(operation: string, fields: Record<string, unknown>, signal: AbortSignal): Promise<AudioReply> {
      operations.push({ operation, fields, aborted: signal.aborted });
      return { elapsed_ms: 1, ...(operation === "record_stop" ? { file: fields.file as string } : {}), ...(operation === "transcribe" ? { text: transcripts.shift() ?? "" } : {}) };
    },
    async removeAudio(file: string) { removed.push(file); },
  };
  const terminal = {
    async choose(_title: string | (() => string), _keys: string[], _signal?: AbortSignal, timeoutMs?: number) { timeouts.push(timeoutMs); return choices.shift() ?? null; },
    async ask() { return texts.shift() ?? null; },
  };
  return { operations, removed, messages, timeouts, abort, inference, terminal,
    run: () => microphoneInput(terminal, inference, abort.signal, "es", message => messages.push(message)) };
}
test("Space starts and stops immediately, transcription auto-detects language, and audio is removed", async () => {
  const f = fixture(["space", "space"]);
  expect(await f.run()).toBe("Hola, una cita.");
  expect(f.operations.map(x => x.operation)).toEqual(["record_start", "record_stop", "transcribe"]);
  expect(f.operations[2]!.fields).not.toHaveProperty("language");
  expect(f.removed).toEqual([f.operations[1]!.fields.file as string]);
  expect(f.timeouts).toEqual([undefined, RECORDING_LIMIT_MS]);
});
test("Esc discards a take without transcription and returns to caller controls", async () => {
  const f = fixture(["space", null, "t"], ["Typed reply"]);
  expect(await f.run()).toBe("Typed reply");
  expect(f.operations.map(x => x.operation)).toEqual(["record_start", "record_cancel"]);
  expect(f.removed).toHaveLength(1);
});
test("silent takes retry, automatic cutoff sends, and cancelling text returns to controls", async () => {
  const f = fixture(["t", "space", "timeout", "space", "space"], [null], ["", "Good morning"]);
  expect(await f.run()).toBe("Good morning");
  expect(f.messages).toContain("30-second limit reached · transcribing…");
  expect(f.messages).toContain("No speech detected. Space to try again, or t to type.");
  expect(f.removed).toHaveLength(2);
});
test("parent cancellation while recording closes the microphone using a live cleanup signal", async () => {
  const f = fixture([]);
  let step = 0;
  f.terminal.choose = async () => { if (++step === 1) return "space"; f.abort.abort(); return null; };
  await expect(f.run()).rejects.toThrow();
  expect(f.operations.map(x => x.operation)).toEqual(["record_start", "record_cancel"]);
  expect(f.operations.at(-1)!.aborted).toBe(false);
  expect(f.removed).toHaveLength(1);
});
test("transcription failure removes audio and start failure does not attempt to stop a missing capture", async () => {
  const f = fixture(["space", "space"]);
  const audio = f.inference.audio;
  f.inference.audio = async (...args) => { if (args[0] === "transcribe") throw new Error("ASR unavailable"); return audio(...args); };
  await expect(f.run()).rejects.toThrow("ASR unavailable");
  expect(f.removed).toHaveLength(1);
  const failure = fixture(["space"]);
  failure.inference.audio = async () => { throw new Error("Microphone permission denied"); };
  await expect(failure.run()).rejects.toThrow("Microphone permission denied");
  expect(failure.removed).toHaveLength(1);
});
test("Esc or an already-aborted signal never opens the microphone", async () => {
  const f = fixture([null]); expect(await f.run()).toBeNull(); expect(f.operations).toHaveLength(0);
  f.abort.abort(); expect(await f.run()).toBeNull(); expect(f.operations).toHaveLength(0);
});
