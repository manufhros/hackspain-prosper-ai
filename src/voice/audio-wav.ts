/** Encode telephony mu-law as PCM16 WAV without starting Python or a model. */
export function muLawWav(payload: unknown): Buffer {
  if (typeof payload !== "string" || !payload || payload.length > 320000) throw new Error("Expected at most 30 seconds of mu-law audio");
  const raw = Buffer.from(payload, "base64");
  if (!raw.length || raw.length > 240000 || raw.toString("base64") !== payload) throw new Error("Invalid mu-law audio");
  const wav = Buffer.alloc(44 + raw.length * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(raw.length * 2, 40);
  for (let i = 0; i < raw.length; i++) {
    const value = (~raw[i]!) & 255;
    const magnitude = (((value & 15) << 3) + 132) << ((value & 112) >> 4);
    wav.writeInt16LE(value & 128 ? 132 - magnitude : magnitude - 132, 44 + i * 2);
  }
  return wav;
}

/** Only our bounded mono PCM16 captures are uploaded; reject malformed files locally. */
export function validateSpeechWav(wav: Buffer): void {
  if (wav.length < 44 || wav.length > 1024 * 1024 || wav.toString("ascii", 0, 4) !== "RIFF"
    || wav.toString("ascii", 8, 12) !== "WAVE" || wav.readUInt32LE(4) !== wav.length - 8)
    throw new Error("Expected a bounded PCM16 WAV recording");
  let rate = 0, dataBytes = 0, formats = 0, blocks = 0, offset = 12;
  while (offset + 8 <= wav.length) {
    const kind = wav.toString("ascii", offset, offset + 4), size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > wav.length) throw new Error("Truncated WAV recording");
    if (kind === "fmt ") {
      if (++formats !== 1 || size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1
        || wav.readUInt16LE(start + 12) !== 2 || wav.readUInt16LE(start + 14) !== 16)
        throw new Error("Expected mono PCM16 WAV recording");
      rate = wav.readUInt32LE(start + 4);
      if (![8000, 16000].includes(rate) || wav.readUInt32LE(start + 8) !== rate * 2) throw new Error("Unsupported WAV sample rate");
    }
    if (kind === "data") { blocks++; dataBytes = size; }
    offset = start + size + (size % 2);
  }
  if (offset !== wav.length || formats !== 1 || blocks !== 1 || !dataBytes || dataBytes % 2 || dataBytes > rate * 2 * 30)
    throw new Error("Expected at most 30 seconds of PCM16 WAV audio");
}
