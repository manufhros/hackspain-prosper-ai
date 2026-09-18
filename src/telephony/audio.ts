import { type ObjectValue } from "../data";
import { type AudioReply, type Inference } from "../voice/runtime";

export function muLawSample(byte: number): number {
  const value = (~byte) & 255;
  const magnitude = (((value & 15) << 3) + 132) << ((value & 112) >> 4);
  return (value & 128 ? 132 - magnitude : magnitude - 132) / 32768;
}
export function frameEnergy(frame: Uint8Array): number {
  return Math.sqrt(frame.reduce((sum, byte) => sum + muLawSample(byte) ** 2, 0) / frame.length);
}
export interface VadOptions { threshold: number; silenceMs: number; maxSpeechMs: number }
export const defaultVad: VadOptions = { threshold: 0.015, silenceMs: 800, maxSpeechMs: 20_000 };

/** Bounded 20 ms frame segmenter, with 200 ms pre-roll and 120 ms speech onset. */
export class VoiceActivity {
  private pre: Buffer[] = [];
  private frames: Buffer[] = [];
  private voiced = 0;
  private silence = 0;
  speaking = false;
  constructor(private options: VadOptions = defaultVad) {}
  push(frame: Buffer): { started: boolean; utterance?: Buffer } {
    if (frame.length !== 160) throw new Error("Expected a 20 ms mu-law frame");
    const loud = frameEnergy(frame) >= this.options.threshold;
    let started = false;
    if (!this.speaking) {
      this.pre.push(frame); if (this.pre.length > 10) this.pre.shift();
      this.voiced = loud ? this.voiced + 1 : 0;
      if (this.voiced >= 6) {
        this.speaking = true; started = true; this.frames = this.pre; this.pre = []; this.silence = 0;
      }
    } else {
      this.frames.push(frame); this.silence = loud ? 0 : this.silence + 1;
      if (this.silence * 20 >= this.options.silenceMs || this.frames.length * 20 >= this.options.maxSpeechMs) return { started, utterance: this.flush() };
    }
    return { started };
  }
  flush(): Buffer | undefined {
    const result = this.speaking ? Buffer.concat(this.frames) : undefined;
    this.reset(); return result;
  }
  reset() { this.pre = []; this.frames = []; this.voiced = 0; this.silence = 0; this.speaking = false; }
}

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Cancelled"));
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new Error("Cancelled")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** The native worker is serial. Call cancellation must never kill other calls. */
export class SharedAudio {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  constructor(private inference: Pick<Inference, "audio">, private lifetime: AbortSignal) {}
  run(operation: string, fields: ObjectValue, signal: AbortSignal): Promise<AudioReply> {
    signal.throwIfAborted(); this.lifetime.throwIfAborted();
    if (this.queued >= 60) return Promise.reject(new Error("Audio queue is full"));
    this.queued++;
    const work = this.tail.then(async () => {
      signal.throwIfAborted(); this.lifetime.throwIfAborted();
      // A cancelled call stops waiting immediately; an already running native
      // operation finishes privately before the next caller uses the worker.
      return this.inference.audio(operation, fields, this.lifetime);
    }).finally(() => { this.queued--; });
    this.tail = work.catch(() => {});
    return abortable(work, signal);
  }
}
