import {
  GREETING,
  muLawFrames,
  speakToMuLaw,
  transcribeUtterance,
} from "./agent";
import { decodeMuLaw, rms } from "./audio";
import { TurnEngine } from "./turn/engine";

type TwilioEvent = {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
  media?: { payload: string; track?: string };
};

const SPEECH_RMS = 500;
const SILENCE_FRAMES = 28;
const MIN_SPEECH_FRAMES = 10;
const BARGE_FRAMES = 8;

export class CallSession {
  private streamSid: string | null = null;
  private callId: string | null = null;
  private fromNumber: string | null = null;
  private engine: TurnEngine | null = null;
  private pcmChunks: Int16Array[] = [];
  private speechFrames = 0;
  private silenceFrames = 0;
  private inSpeech = false;
  private busy = false;
  private playing = false;
  private bargeFrames = 0;
  private playGeneration = 0;
  private closed = false;

  constructor(private readonly ws: { send: (data: string) => void }) {}

  async onMessage(raw: string | Buffer) {
    if (this.closed) return;
    const text = typeof raw === "string" ? raw : raw.toString();
    let msg: TwilioEvent;
    try {
      msg = JSON.parse(text) as TwilioEvent;
    } catch {
      return;
    }
    if (msg.event === "connected") return;
    if (msg.event === "start") {
      this.streamSid = msg.start?.streamSid ?? msg.streamSid ?? null;
      this.callId = msg.start?.callSid ?? msg.start?.customParameters?.call_id ?? null;
      this.fromNumber = msg.start?.customParameters?.from_number ?? null;
      if (this.callId) {
        this.engine = new TurnEngine(this.callId, this.fromNumber, {
          onTool: (tool) => console.log("tool", tool.name, tool.input, tool.output),
        });
      }
      console.log("call start", { callId: this.callId, streamSid: this.streamSid, from: this.fromNumber });
      void this.greet();
      return;
    }
    if (msg.event === "media" && msg.media?.payload) {
      this.onAudio(msg.media.payload);
      return;
    }
    if (msg.event === "stop") {
      console.log("call stop", this.callId);
      this.close();
    }
  }

  close() {
    this.closed = true;
    this.playGeneration += 1;
  }

  private onAudio(b64: string) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pcm = decodeMuLaw(bytes);
    const level = rms(pcm);

    if (this.playing) {
      if (level > SPEECH_RMS) {
        this.bargeFrames += 1;
        if (this.bargeFrames >= BARGE_FRAMES) {
          this.playGeneration += 1;
          this.playing = false;
          this.bargeFrames = 0;
        }
      } else {
        this.bargeFrames = 0;
      }
      return;
    }

    if (this.busy) return;

    if (level > SPEECH_RMS) {
      this.inSpeech = true;
      this.speechFrames += 1;
      this.silenceFrames = 0;
      this.pcmChunks.push(pcm);
      return;
    }

    if (!this.inSpeech) return;
    this.silenceFrames += 1;
    this.pcmChunks.push(pcm);
    if (this.silenceFrames >= SILENCE_FRAMES) {
      const spoken = this.speechFrames;
      const utterance = this.flushPcm();
      this.inSpeech = false;
      this.speechFrames = 0;
      this.silenceFrames = 0;
      if (spoken >= MIN_SPEECH_FRAMES) void this.handleUtterance(utterance);
    }
  }

  private flushPcm(): Int16Array {
    const total = this.pcmChunks.reduce((n, c) => n + c.length, 0);
    const out = new Int16Array(total);
    let o = 0;
    for (const chunk of this.pcmChunks) {
      out.set(chunk, o);
      o += chunk.length;
    }
    this.pcmChunks = [];
    return out;
  }

  private async greet() {
    await this.speak(GREETING);
  }

  private async handleUtterance(pcm: Int16Array) {
    if (!this.callId || this.busy || this.closed) return;
    this.busy = true;
    try {
      const transcript = await transcribeUtterance(pcm);
      console.log("user:", transcript);
      if (!transcript) return;
      if (!this.engine) return;
      const reply = await this.engine.process(transcript);
      console.log("agent:", reply.text);
      if (!reply.text) return;
      await this.speak(reply.text);
    } catch (err) {
      console.error("turn failed", err);
    } finally {
      this.busy = false;
    }
  }

  private async speak(text: string) {
    if (!this.streamSid || this.closed) return;
    const mu = await speakToMuLaw(text);
    const generation = ++this.playGeneration;
    this.playing = true;
    try {
      for (const frame of muLawFrames(mu)) {
        if (this.closed || generation !== this.playGeneration) break;
        this.ws.send(
          JSON.stringify({
            event: "media",
            streamSid: this.streamSid,
            media: { payload: Buffer.from(frame).toString("base64") },
          }),
        );
        await Bun.sleep(18);
      }
    } finally {
      if (generation === this.playGeneration) this.playing = false;
    }
  }
}
