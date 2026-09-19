import { voice } from "@livekit/agents";
import { AudioFrame as PCMFrame } from "@livekit/rtc-node";
import {
  ReadableStream,
  type ReadableStreamDefaultController,
} from "node:stream/web";
import {
  TELEPHONE_AUDIO,
  sameFormat,
  type AudioFrame,
  type EngineHost,
} from "../../contracts/src/index.js";

export function decodeMulaw(data: Uint8Array): Int16Array {
  return Int16Array.from(data, (byte) => {
    const u = ~byte & 255;
    const value = ((((u & 15) << 3) + 132) << ((u >> 4) & 7)) - 132;
    return u & 128 ? -value : value;
  });
}
export function encodeMulaw(data: Int16Array): Uint8Array {
  return Uint8Array.from(data, (sample) => {
    const sign = sample < 0 ? 128 : 0;
    let value = Math.min(Math.abs(sample), 32635) + 132;
    let exponent = 7;
    for (let mask = 0x4000; exponent > 0 && !(value & mask); mask >>= 1)
      exponent--;
    return ~(sign | (exponent << 4) | ((value >> (exponent + 3)) & 15)) & 255;
  });
}

/** Bounded telephone input: no rooms or external LiveKit transport required. */
export class TelephoneInput extends voice.AudioInput {
  private controller!: ReadableStreamDefaultController<PCMFrame>;
  private ended = false;
  constructor() {
    super();
    this.multiStream.addInputStream(
      new ReadableStream<PCMFrame>(
        {
          start: (controller) => {
            this.controller = controller;
          },
        },
        { highWaterMark: 250 },
      ),
    );
  }
  push(frame: AudioFrame) {
    if (this.ended) return;
    if (!sameFormat(frame.format, TELEPHONE_AUDIO))
      throw new Error("Expected telephone audio");
    if ((this.controller.desiredSize ?? 0) <= 0)
      throw new Error("LiveKit input backlog exceeded");
    const pcm = decodeMulaw(frame.data);
    this.controller.enqueue(new PCMFrame(pcm, 8000, 1, pcm.length));
  }
  async close() {
    if (!this.ended) {
      this.ended = true;
      this.controller.close();
    }
    await super.close();
  }
}

/** Real-time sink with a reversible pause, unlike a destructive transport clear.
 * Only 20 ms is handed to the existing paced transport at a time. Position is
 * transport-delivered audio, not a claim of device-level playback acknowledgement.
 */
export class TelephoneOutput extends voice.AudioOutput {
  private epoch = 0;
  private gate?: Promise<void>;
  private release?: () => void;
  private position = 0;
  private started = false;
  private segment = false;
  private pending = Promise.resolve();
  constructor(private host: EngineHost) {
    super(8000, undefined, { pause: true });
  }
  async captureFrame(frame: PCMFrame) {
    const epoch = this.epoch;
    const work = this.pending.then(async () => {
      if (this.gate) await this.gate;
      if (epoch !== this.epoch) return;
      if (frame.sampleRate !== 8000 || frame.channels !== 1)
        throw new Error("Expected PCM 8 kHz mono");
      await super.captureFrame(frame);
      this.segment = true;
      const bytes = encodeMulaw(frame.data);
      for (let offset = 0; offset < bytes.length; offset += 160) {
        if (this.gate) await this.gate;
        if (epoch !== this.epoch) return;
        if (!this.started) {
          this.started = true;
          this.onPlaybackStarted(Date.now());
        }
        const data = bytes.subarray(offset, offset + 160);
        const startedAt = Date.now();
        await this.host.audio({ data, format: TELEPHONE_AUDIO });
        if (epoch !== this.epoch) return;
        this.onPlaybackProgressed({
          startedAt,
          offset: this.position * 1000,
          duration: data.length / 8,
        });
        this.position += data.length / 8000;
      }
    });
    this.pending = work.catch(() => {});
    return work;
  }
  flush() {
    super.flush();
    const epoch = this.epoch;
    void this.pending.then(() => {
      if (epoch === this.epoch) this.finish(false);
    });
  }
  private finish(interrupted: boolean) {
    if (!this.segment) return;
    this.segment = false;
    this.onPlaybackFinished({ playbackPosition: this.position, interrupted });
    this.position = 0;
    this.started = false;
  }
  clearBuffer() {
    this.epoch++;
    this.release?.();
    this.gate = undefined;
    this.release = undefined;
    this.host.interrupt();
    this.finish(true);
    this.abandonOpenSegment();
  }
  pause() {
    if (this.gate) return;
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
    this.host.event("audio.paused");
    // Let the one in-flight 20 ms packet finish; clearing it would lose resumable audio.
  }
  resume() {
    if (!this.gate) return;
    this.release?.();
    this.gate = undefined;
    this.release = undefined;
    this.host.event("audio.resumed");
  }
}
