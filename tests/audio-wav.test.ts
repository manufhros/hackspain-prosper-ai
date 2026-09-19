import { expect, test } from "bun:test";
import { muLawWav, validateSpeechWav } from "../src/voice/audio-wav";

test("mu-law conversion produces bounded 8 kHz PCM16 WAV with correct sign and amplitude", () => {
  const wav = muLawWav(Buffer.from([255, 127, 0, 128]).toString("base64"));
  validateSpeechWav(wav);
  expect(wav.readUInt32LE(24)).toBe(8000);
  expect([0, 1, 2, 3].map(i => wav.readInt16LE(44 + i * 2))).toEqual([0, 0, -32124, 32124]);
  for (const value of ["", "!!!", "AA", "A".repeat(320004), null]) expect(() => muLawWav(value)).toThrow();
});

test("WAV validation rejects wrong formats, truncated data and excessive duration before upload", () => {
  const wav = muLawWav(Buffer.alloc(8000, 255).toString("base64"));
  validateSpeechWav(wav);
  for (const change of [(b: Buffer) => b.writeUInt16LE(2, 22), (b: Buffer) => b.writeUInt16LE(8, 34),
    (b: Buffer) => b.writeUInt32LE(1234, 24), (b: Buffer) => b.writeUInt32LE(999999, 40),
    (b: Buffer) => b.write("nope", 0)]) {
    const copy = Buffer.from(wav); change(copy); expect(() => validateSpeechWav(copy)).toThrow();
  }
  expect(() => validateSpeechWav(wav.subarray(0, wav.length - 1))).toThrow();
});
