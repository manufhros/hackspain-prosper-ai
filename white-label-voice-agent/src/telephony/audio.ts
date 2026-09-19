/**
 * Códec y utilidades de audio para Twilio Media Streams.
 * Twilio habla mu-law mono a 8 kHz en frames de 20 ms (160 muestras).
 * Portado del pipeline propio de `src/audio.ts` del repo raíz.
 */
export const PHONE_RATE = 8000;
export const FRAME_SAMPLES = 160;

const BIAS = 0x84;
const CLIP = 32635;

function muLawByteToPcm(uVal: number): number {
  const u = ~uVal & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

function pcmToMuLawByte(sample: number): number {
  let pcm = sample;
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    /* find segment */
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function decodeMuLaw(payload: Uint8Array): Int16Array {
  const pcm = new Int16Array(payload.length);
  for (let i = 0; i < payload.length; i++) pcm[i] = muLawByteToPcm(payload[i]!);
  return pcm;
}

export function encodeMuLaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcmToMuLawByte(pcm[i]!);
  return out;
}

export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (const s of pcm) sum += s * s;
  return Math.sqrt(sum / pcm.length);
}

export function resample(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const n = Math.max(1, Math.floor(pcm.length / ratio));
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.min(pcm.length - 1, Math.floor(x));
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const frac = x - i0;
    const a = pcm[i0] ?? 0;
    const b = pcm[i1] ?? 0;
    out[i] = Math.round(a + (b - a) * frac);
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function ascii(view: DataView, offset: number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let o = 44;
  for (const sample of pcm) {
    view.setInt16(o, sample, true);
    o += 2;
  }
  return new Uint8Array(buffer);
}

export function wavToPcm16(wav: Uint8Array): { pcm: Int16Array; sampleRate: number } {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("not a wav file");
  }
  let offset = 12;
  let sampleRate = PHONE_RATE;
  let channels = 1;
  let bits = 16;
  let data: Uint8Array | null = null;
  while (offset + 8 <= wav.length) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt ") {
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === "data") {
      data = wav.subarray(start, start + size);
      break;
    }
    offset = start + size + (size % 2);
  }
  if (!data) throw new Error("wav has no data chunk");
  if (bits !== 16) throw new Error(`unsupported wav bit depth ${bits}`);
  const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  if (channels === 1) return { pcm: new Int16Array(samples), sampleRate };
  const mono = new Int16Array(Math.floor(samples.length / channels));
  for (let i = 0; i < mono.length; i++) mono[i] = samples[i * channels] ?? 0;
  return { pcm: mono, sampleRate };
}

export function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
  return chunks;
}

export const MULAW_SILENCE_FRAME = encodeMuLaw(new Int16Array(FRAME_SAMPLES));
