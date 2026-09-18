/** G.711 µ-law (Twilio) ↔ PCM16 16 kHz (ElevenLabs ConvAI). */

function mulawByteToPcm(mu: number): number {
  const inverted = ~mu & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function pcmToMulawByte(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let s = sample;
  let sign = 0;
  if (s < 0) {
    sign = 0x80;
    s = -s;
  }
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (s & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    /* find exponent */
  }
  const mantissa = (s >> (exponent === 0 ? 4 : exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function upsample8kTo16k(pcm8k: Int16Array): Int16Array {
  const out = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    const a = pcm8k[i] ?? 0;
    const b = pcm8k[i + 1] ?? a;
    out[i * 2] = a;
    out[i * 2 + 1] = Math.round((a + b) / 2);
  }
  return out;
}

export function twilioUlawToPcm16kBase64(ulawB64: string): string {
  const ulaw = Buffer.from(ulawB64, "base64");
  const pcm8k = new Int16Array(ulaw.length);
  for (let i = 0; i < ulaw.length; i++) {
    pcm8k[i] = mulawByteToPcm(ulaw[i] ?? 0);
  }
  const pcm16k = upsample8kTo16k(pcm8k);
  return Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength).toString("base64");
}

export function pcm16kBase64ToTwilioUlaw(pcmB64: string, leftover: Int16Array): {
  payload: string;
  leftover: Int16Array;
} {
  const bytes = Buffer.from(pcmB64, "base64");
  const incoming = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const merged = new Int16Array(leftover.length + incoming.length);
  merged.set(leftover);
  merged.set(incoming, leftover.length);
  const even = merged.length & ~1;
  const ulaw = Buffer.alloc(even / 2);
  for (let i = 0, o = 0; i < even; i += 2, o++) {
    const a = merged[i] ?? 0;
    const b = merged[i + 1] ?? a;
    ulaw[o] = pcmToMulawByte(Math.round((a + b) / 2));
  }
  return {
    payload: ulaw.toString("base64"),
    leftover: merged.slice(even),
  };
}
