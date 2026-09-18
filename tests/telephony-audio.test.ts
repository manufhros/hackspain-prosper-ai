import { expect, test } from "bun:test";
import { defaultVad, frameEnergy, SharedAudio, VoiceActivity } from "../src/telephony/audio";
import { type AudioReply } from "../src/voice/runtime";
const silence = Buffer.alloc(160, 255), speech = Buffer.alloc(160, 160);

test("mu-law silence and speech segmentation preserve pre-roll and end on a pause", () => {
  expect(frameEnergy(silence)).toBe(0); expect(frameEnergy(speech)).toBeGreaterThan(defaultVad.threshold);
  const vad = new VoiceActivity();
  for (let i = 0; i < 100; i++) expect(vad.push(silence).utterance).toBeUndefined();
  for (let i = 0; i < 5; i++) expect(vad.push(speech).started).toBe(false);
  expect(vad.push(speech).started).toBe(true);
  for (let i = 0; i < 39; i++) expect(vad.push(silence).utterance).toBeUndefined();
  const audio = vad.push(silence).utterance!;
  expect(audio.length).toBe(50 * 160); expect(vad.speaking).toBe(false);
  expect(vad.flush()).toBeUndefined();
});
test("sustained noise cannot create an unbounded utterance; stop flushes final speech", () => {
  const vad = new VoiceActivity({ ...defaultVad, maxSpeechMs: 1000 });
  let utterance: Buffer | undefined;
  for (let i = 0; i < 50; i++) utterance = vad.push(speech).utterance;
  expect(utterance?.length).toBe(50 * 160);
  for (let i = 0; i < 6; i++) vad.push(speech);
  expect(vad.flush()?.length).toBe(6 * 160);
});
test("one caller cancelling cannot abort native audio or another caller", async () => {
  const lifetime = new AbortController(), caller = new AbortController();
  const pending: ((value: AudioReply) => void)[] = [];
  const signals: AbortSignal[] = [];
  const queue = new SharedAudio({ audio: async (_op, _fields, signal) => {
    signals.push(signal); return new Promise(resolve => pending.push(resolve));
  } }, lifetime.signal);
  const first = queue.run("speak", {}, caller.signal);
  const second = queue.run("speak", {}, new AbortController().signal);
  await Bun.sleep(0); expect(pending).toHaveLength(1);
  caller.abort(); await expect(first).rejects.toThrow(); expect(signals[0]!.aborted).toBe(false);
  pending.shift()!({ elapsed_ms: 1 }); await Bun.sleep(0);
  expect(pending).toHaveLength(1); pending.shift()!({ elapsed_ms: 2 });
  expect((await second).elapsed_ms).toBe(2);
});


test("simultaneous fixed greetings share synthesis while cancellation stays per caller", async () => {
  const lifetime = new AbortController(), caller = new AbortController();
  let resolve!: (reply: AudioReply) => void, syntheses = 0;
  const queue = new SharedAudio({ audio: async () => { syntheses++; return new Promise(done => resolve = done); } }, lifetime.signal);
  const phrase = { text: "Clínica Arenal", language: "es", wire: true, cache: true };
  const first = queue.run("speak", phrase, caller.signal);
  const others = Array.from({ length: 4 }, () => queue.run("speak", phrase, new AbortController().signal));
  await Bun.sleep(0); expect(syntheses).toBe(1);
  caller.abort(); await expect(first).rejects.toThrow();
  resolve({ payload: "synthetic", elapsed_ms: 5 });
  const replies = await Promise.all(others);
  expect(replies.every(reply => reply.cache_hit && reply.queue_ms !== undefined)).toBe(true);
  expect(syntheses).toBe(1);
  expect((await queue.run("speak", phrase, new AbortController().signal)).cache_hit).toBe(true);
});

test("patient speech is not cached and queue wait is measured separately", async () => {
  const lifetime = new AbortController(); let release!: () => void, calls = 0;
  const queue = new SharedAudio({ audio: async () => {
    if (++calls === 1) await new Promise<void>(resolve => release = resolve);
    return { payload: "synthetic", elapsed_ms: 1 };
  } }, lifetime.signal);
  const fields = { text: "Patient appointment details", language: "en", wire: true };
  const first = queue.run("speak", fields, lifetime.signal), second = queue.run("speak", fields, lifetime.signal);
  await Bun.sleep(10); release(); await first;
  const reply = await second;
  expect(calls).toBe(2); expect(reply.cache_hit).toBe(false); expect(reply.queue_ms).toBeGreaterThanOrEqual(5);
  expect(reply.elapsed_ms).toBe(1);
});
