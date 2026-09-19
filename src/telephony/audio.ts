import { WorkQueue } from "../voice/queue";
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
export const defaultVad: VadOptions = { threshold: 0.015, silenceMs: 480, maxSpeechMs: 20_000 };

/** Bounded 20 ms frame segmenter, with 200 ms pre-roll and 120 ms speech onset. */
export class VoiceActivity {
  private pre: Buffer[] = [];
  private frames: Buffer[] = [];
  private voiced = 0;
  private silence = 0;
  speaking = false;
  constructor(private options: VadOptions = defaultVad) {}
  push(frame: Buffer, speech?: boolean): { started: boolean; utterance?: Buffer } {
    if (frame.length !== 160) throw new Error("Expected a 20 ms mu-law frame");
    const loud = speech ?? frameEnergy(frame) >= this.options.threshold;
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

/** Independent bounded ASR/TTS lanes. Caller cancellation never kills shared native work. */
export class SharedAudio {
  private recognition = new WorkQueue(1);
  private synthesis: WorkQueue;
  private speechCache = new Map<string, Promise<AudioReply>>();
  constructor(private inference: Pick<Inference, "audio">, private lifetime: AbortSignal, ttsWorkers = 1) {
    this.synthesis = new WorkQueue(ttsWorkers);
  }
  run(operation: string, fields: ObjectValue, signal: AbortSignal): Promise<AudioReply> {
    signal.throwIfAborted(); this.lifetime.throwIfAborted();
    const queuedAt = performance.now();
    // Only explicitly marked, fixed service phrases are cached. Patient speech is not.
    const cacheKey = operation === "speak" && fields.cache === true && fields.wire === true
      ? JSON.stringify([fields.language, fields.text]) : undefined;
    const cached = cacheKey ? this.speechCache.get(cacheKey) : undefined;
    if (cached) return abortable(cached.then(reply => ({ ...reply, elapsed_ms: 0,
      queue_ms: Math.round(performance.now() - queuedAt), total_ms: Math.round(performance.now() - queuedAt), cache_hit: true })), signal);
    const lane = operation === "speak" ? this.synthesis : this.recognition;
    const work = lane.run(async queue_ms => {
      this.lifetime.throwIfAborted();
      // A started native request retains its slot until it finishes, even after caller cancellation.
      const reply = await this.inference.audio(operation, fields, this.lifetime);
      return { ...reply, queue_ms: queue_ms + (reply.queue_ms ?? 0),
        total_ms: Math.round(performance.now() - queuedAt), cache_hit: false };
    }, cacheKey ? this.lifetime : AbortSignal.any([signal, this.lifetime]));
    if (cacheKey) {
      if (this.speechCache.size >= 24) this.speechCache.delete(this.speechCache.keys().next().value!);
      this.speechCache.set(cacheKey, work);
      void work.catch(() => { if (this.speechCache.get(cacheKey) === work) this.speechCache.delete(cacheKey); });
    }
    return abortable(work, signal);
  }
}
