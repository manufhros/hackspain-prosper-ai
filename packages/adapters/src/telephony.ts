import type WebSocket from "ws";
import { z } from "zod";
import {
  TELEPHONE_AUDIO,
  sameFormat,
  type AudioFrame,
} from "../../contracts/src/index.js";

export const startSchema = z.object({
  event: z.literal("start"),
  streamSid: z.string().min(1),
  start: z.object({
    callSid: z.string().min(1).max(200),
    mediaFormat: z.object({
      encoding: z.literal("audio/x-mulaw"),
      sampleRate: z.literal(8000),
      channels: z.literal(1),
    }),
  }),
});
/** Pace locally: the Prosper harness does not honour Twilio's clear event. */
export class PacedAudio {
  private epoch = 0;
  private tail = Promise.resolve();
  private queued = 0;
  constructor(
    private socket: WebSocket,
    private streamSid: string,
  ) {}
  clear() {
    this.epoch++;
  }
  write(frame: AudioFrame) {
    if (!sameFormat(frame.format, TELEPHONE_AUDIO))
      return Promise.reject(new Error("Unsupported output format"));
    if (this.queued + frame.data.length > 8000 * 30)
      return Promise.reject(new Error("Audio output queue exceeded"));
    this.queued += frame.data.length;
    const epoch = this.epoch;
    const work = this.tail
      .then(async () => {
        for (let offset = 0; offset < frame.data.length; offset += 160) {
          if (epoch !== this.epoch || this.socket.readyState !== 1) return;
          if (this.socket.bufferedAmount > 8000)
            throw new Error("Slow telephone transport");
          const chunk = Buffer.from(frame.data.subarray(offset, offset + 160));
          this.socket.send(
            JSON.stringify({
              event: "media",
              streamSid: this.streamSid,
              media: { payload: chunk.toString("base64") },
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, chunk.length / 8));
        }
      })
      .finally(() => {
        this.queued -= frame.data.length;
      });
    this.tail = work.catch(() => {});
    return work;
  }
}
