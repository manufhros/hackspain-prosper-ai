import { expect, test } from "bun:test";
import { SileroStream, type VadKernel } from "../src/telephony/silero";
import { defaultVad, VoiceActivity } from "../src/telephony/audio";

const speech = Buffer.alloc(160, 160), silence = Buffer.alloc(160, 255);

test("Silero uses 256 sample windows with 32 sample context and isolated recurrent state", async () => {
  const inputs: { input: Float32Array; state: Float32Array }[] = [];
  const kernel: VadKernel = async (input, state) => {
    inputs.push({ input: input.slice(), state: state.slice() });
    return { probability: 0.9, state: new Float32Array(256).fill(1) };
  };
  const a = new SileroStream(kernel), b = new SileroStream(kernel);
  expect(await a.push(speech)).toBe(false);
  expect(await a.push(speech)).toBe(true);
  await b.push(silence); await b.push(silence);
  await a.push(speech); await a.push(speech);
  expect(inputs.map(x => x.input.length)).toEqual([288, 288, 288]);
  expect(inputs[0]!.state.every(x => x === 0)).toBe(true);
  expect(inputs[1]!.state.every(x => x === 0)).toBe(true);
  expect(inputs[2]!.state.every(x => x === 1)).toBe(true);
  expect(inputs[2]!.input.slice(0, 32)).toEqual(inputs[0]!.input.slice(-32));
  a.reset(); await a.push(silence); await a.push(silence);
  expect(inputs.at(-1)!.state.every(x => x === 0)).toBe(true);
});

test("Silero hysteresis avoids toggling on borderline probabilities", async () => {
  const probabilities = [0.8, 0.4, 0.2];
  const stream = new SileroStream(async () => ({ probability: probabilities.shift()!, state: new Float32Array(256) }));
  await stream.push(speech); expect(await stream.push(speech)).toBe(true);
  await stream.push(speech); expect(await stream.push(speech)).toBe(true);
  expect(await stream.push(speech)).toBe(false);
});

test("neural speech decisions override energy without losing original telephone frames", () => {
  const vad = new VoiceActivity();
  for (let i = 0; i < 20; i++) expect(vad.push(speech, false).started).toBe(false);
  for (let i = 0; i < 5; i++) expect(vad.push(speech, true).started).toBe(false);
  expect(vad.push(speech, true).started).toBe(true);
  let audio: Buffer | undefined;
  for (let i = 0; i < defaultVad.silenceMs / 20; i++) audio = vad.push(speech, false).utterance;
  expect(audio?.length).toBe((10 + defaultVad.silenceMs / 20) * 160);
  expect(audio?.every(byte => byte === 160)).toBe(true);
});
