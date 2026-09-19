/** 20 ms of 8 kHz µ-law (Twilio frame). Audible hold, not 0xff silence. */

const FRAME = 160;
const RATE = 8000;

function linearToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    /* find exponent */
  }
  const mantissa = (sample >> (exponent === 0 ? 4 : exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function buildLoop(): string[] {
  const frames: string[] = [];
  const total = RATE * 2;
  const pcm = Buffer.alloc(FRAME);
  for (let offset = 0; offset < total; offset += FRAME) {
    for (let i = 0; i < FRAME; i++) {
      const t = (offset + i) / RATE;
      const burst = t % 2 < 0.35;
      const sample = burst
        ? 0.18 * Math.sin(2 * Math.PI * 880 * t) + 0.08 * Math.sin(2 * Math.PI * 659 * t)
        : 0.02 * Math.sin(2 * Math.PI * 220 * t);
      pcm[i] = linearToMulaw(sample * 32767);
    }
    frames.push(pcm.toString("base64"));
  }
  return frames;
}

const LOOP = buildLoop();

export function holdFrame(tick: number): string {
  return LOOP[tick % LOOP.length] ?? LOOP[0]!;
}
