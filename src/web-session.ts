import {
  GREETING,
  speakWav,
  transcribeUtterance,
} from "./agent";
import { resample, rms } from "./audio";
import { TurnEngine, type ToolTrace } from "./turn/engine";

export type DebugEvent = {
  t: string;
  stage: string;
  message: string;
  data?: unknown;
  ms?: number;
};

export type LabEvent =
  | { type: "ready"; callId: string }
  | { type: "status"; status: "idle" | "listening" | "thinking" | "speaking" }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "tool"; tool: ToolTrace }
  | { type: "debug"; event: DebugEvent }
  | { type: "audio"; mime: "audio/wav"; data: string }
  | { type: "speak-text"; text: string }
  | { type: "error"; message: string };

type Inbound =
  | { type: "hello" }
  | { type: "audio"; pcm: string; sampleRate?: number }
  | { type: "text"; text: string }
  | { type: "hangup" }
  | { type: "playback-end" };

const SPEECH_RMS = 700;
const SILENCE_MS = 380;
const MIN_SPEECH_MS = 280;
const MAX_SPEECH_MS = 8000;

export class WebSession {
  private callId = `local-${crypto.randomUUID()}`;
  private engine: TurnEngine;
  private pcmChunks: Int16Array[] = [];
  private inSpeech = false;
  private silenceSamples = 0;
  private busy = false;
  private playing = false;
  private closed = false;
  private sampleCount = 0;
  private loggedVad = false;
  private muteUntil = 0;
  private playTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly send: (event: LabEvent) => void) {
    this.engine = new TurnEngine(this.callId, null, {
      drySubmit: true,
      onToolStart: (name, input) => this.debug("tool", `→ ${name}`, input),
      onTool: (tool) => {
        this.send({ type: "tool", tool });
        this.debug(
          "tool",
          `← ${tool.name}${tool.ms != null ? ` ${tool.ms}ms` : ""}`,
          tool.output,
          tool.ms,
        );
      },
    });
  }

  private debug(stage: string, message: string, data?: unknown, ms?: number) {
    this.send({
      type: "debug",
      event: { t: new Date().toISOString(), stage, message, data, ms },
    });
  }

  start() {
    this.debug("session", "hello — llamada de laboratorio", { callId: this.callId, drySubmit: true });
    this.send({ type: "ready", callId: this.callId });
    this.send({ type: "transcript", role: "assistant", text: GREETING });
    void this.speak(GREETING);
  }

  close() {
    this.closed = true;
  }

  async onMessage(raw: string | Buffer) {
    if (this.closed) return;
    const text = typeof raw === "string" ? raw : raw.toString();
    let msg: Inbound;
    try {
      msg = JSON.parse(text) as Inbound;
    } catch {
      return;
    }
    if (msg.type === "hello") {
      this.start();
      return;
    }
    if (msg.type === "hangup") {
      this.close();
      return;
    }
    if (msg.type === "playback-end") {
      this.releaseMic("playback-end — mic otra vez");
      return;
    }
    if (msg.type === "text" && msg.text.trim()) {
      await this.handleUserText(msg.text.trim());
      return;
    }
    if (msg.type === "audio" && msg.pcm) {
      try {
        this.onPcm(decodePcm16(msg.pcm), msg.sampleRate ?? 16000);
      } catch (err) {
        console.error("lab pcm", err);
      }
    }
  }

  private releaseMic(reason: string) {
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
    this.playing = false;
    this.flush();
    this.inSpeech = false;
    this.silenceSamples = 0;
    this.sampleCount = 0;
    this.loggedVad = false;
    this.muteUntil = Date.now() + 160;
    this.debug("tts", reason);
    this.send({ type: "status", status: "idle" });
  }

  private onPcm(pcm: Int16Array, sampleRate: number) {
    if (this.busy || this.playing || this.closed) return;
    if (Date.now() < this.muteUntil) return;
    const at16k = resample(pcm, sampleRate, 16000);
    const level = rms(at16k);
    if (level > SPEECH_RMS) {
      if (!this.inSpeech) {
        this.debug("vad", "empieza a hablar");
        this.send({ type: "status", status: "listening" });
      }
      this.inSpeech = true;
      this.loggedVad = true;
      this.silenceSamples = 0;
      this.pcmChunks.push(at16k);
      this.sampleCount += at16k.length;
      if (this.sampleCount >= (16000 * MAX_SPEECH_MS) / 1000) {
        this.commitUtterance("corte por longitud máxima");
      }
      return;
    }
    if (!this.inSpeech) return;
    this.silenceSamples += at16k.length;
    this.pcmChunks.push(at16k);
    this.sampleCount += at16k.length;
    if (this.silenceSamples >= (16000 * SILENCE_MS) / 1000) {
      const enough = this.sampleCount - this.silenceSamples >= (16000 * MIN_SPEECH_MS) / 1000;
      if (enough) this.commitUtterance(`fin de turno · ${Math.round(this.sampleCount / 16)}ms`);
      else {
        this.flush();
        this.inSpeech = false;
        this.silenceSamples = 0;
        this.sampleCount = 0;
        this.loggedVad = false;
        this.debug("vad", "silencio demasiado corto, se descarta");
        this.send({ type: "status", status: "idle" });
      }
    }
  }

  private commitUtterance(reason: string) {
    const utterance = trimSilence(this.flush());
    this.inSpeech = false;
    this.silenceSamples = 0;
    this.sampleCount = 0;
    this.loggedVad = false;
    this.debug("vad", reason);
    void this.handleUtterance(utterance);
  }

  private flush(): Int16Array {
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

  private async handleUtterance(pcm16k: Int16Array) {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.send({ type: "status", status: "thinking" });
    const t0 = Date.now();
    this.debug("stt", `whisper-1 · ${pcm16k.length} samples @16k`);
    try {
      const transcript = await transcribeUtterance(pcm16k, 16000);
      this.debug("stt", transcript ? `"${transcript}"` : "(vacío)", undefined, Date.now() - t0);
      if (!transcript) {
        this.busy = false;
        this.send({ type: "status", status: "idle" });
        return;
      }
      this.busy = false;
      await this.handleUserText(transcript);
    } catch (err) {
      this.busy = false;
      this.send({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      this.debug("error", err instanceof Error ? err.message : String(err));
      this.send({ type: "status", status: "idle" });
    }
  }

  private async handleUserText(text: string) {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.send({ type: "transcript", role: "user", text });
    this.send({ type: "status", status: "thinking" });
    this.debug("llm", "TurnEngine + structured playbook");
    const t0 = Date.now();
    try {
      const reply = await this.engine.process(text);
      this.debug("llm", reply.text ? `"${reply.text}"` : "(sin texto)", { tools: reply.tools.length }, Date.now() - t0);
      this.debug("state", `${reply.state.phase} · turn ${reply.state.turn}`, reply.state);
      this.send({ type: "transcript", role: "assistant", text: reply.text });
      await this.speak(reply.text);
    } catch (err) {
      this.send({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      this.debug("error", err instanceof Error ? err.message : String(err));
      this.send({ type: "status", status: "idle" });
    } finally {
      this.busy = false;
    }
  }

  private async speak(text: string) {
    if (this.closed || !text.trim()) return;
    this.playing = true;
    this.flush();
    this.inSpeech = false;
    this.send({ type: "status", status: "speaking" });
    const t0 = Date.now();
    this.debug("tts", `tts-1-hd nova · "${text.slice(0, 80)}"`);
    try {
      const wav = await speakWav(text);
      this.debug("tts", `wav ${wav.byteLength} bytes`, undefined, Date.now() - t0);
      this.send({
        type: "audio",
        mime: "audio/wav",
        data: Buffer.from(wav).toString("base64"),
      });
      const ms = wavDurationMs(wav) + 220;
      if (this.playTimer) clearTimeout(this.playTimer);
      this.playTimer = setTimeout(() => {
        if (!this.playing || this.closed) return;
        this.releaseMic("timeout — mic otra vez");
      }, ms);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.debug("tts", `Gateway TTS falló, voz del navegador · ${why.slice(0, 140)}`);
      this.send({ type: "speak-text", text });
      if (this.playTimer) clearTimeout(this.playTimer);
      this.playTimer = setTimeout(() => {
        if (!this.playing || this.closed) return;
        this.releaseMic("timeout — mic otra vez");
      }, Math.min(12_000, 400 + text.length * 60));
    }
  }
}

function wavDurationMs(wav: Uint8Array): number {
  if (wav.byteLength < 32) return 1500;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const rate = view.getUint32(24, true) || 24000;
  const bytesPerSec = Math.max(1, rate * 2);
  return Math.max(800, Math.round(((wav.byteLength - 44) / bytesPerSec) * 1000));
}

function trimSilence(pcm: Int16Array, threshold = 400): Int16Array {
  let end = pcm.length;
  while (end > 0 && Math.abs(pcm[end - 1] ?? 0) < threshold) end -= 1;
  const keep = Math.min(pcm.length, end + 1600);
  return keep === pcm.length ? pcm : pcm.slice(0, keep);
}

function decodePcm16(b64: string): Int16Array {
  const bytes = Buffer.from(b64, "base64");
  const out = new Int16Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
  }
  return out;
}
