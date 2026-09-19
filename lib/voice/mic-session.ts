"use client";

import {
  FRAME_SAMPLES,
  PHONE_RATE,
  SILENCE_FRAME,
  chunkBytes,
  decodeMuLaw,
  encodeMuLaw,
  floatToPcm16,
  pcm16ToWav,
  resample,
  rms,
} from "@/lib/audio/phone";
import type { TranscriptTurn } from "@/lib/cases/transcript";

export type MicCallHandlers = {
  onStatus: (status: string) => void;
  onTurn: (turn: TranscriptTurn) => void;
  onTrace?: (turns: TranscriptTurn[]) => void;
};

function e164(phone?: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("34")) return `+${digits}`;
  if (digits.length === 9) return `+34${digits}`;
  return `+${digits}`;
}

function bytesToB64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function b64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function transcribeRemote(pcm: Int16Array) {
  if (pcm.length < PHONE_RATE * 0.4 || rms(pcm) < 400) return "";
  const clip = pcm.length > PHONE_RATE * 12 ? pcm.subarray(pcm.length - PHONE_RATE * 12) : pcm;
  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([pcm16ToWav(clip, PHONE_RATE)], { type: "audio/wav" }),
      "clip.wav",
    );
    const response = await fetch("/api/transcribe", { method: "POST", body: form });
    const raw = await response.text();
    if (!raw) return "";
    const data = JSON.parse(raw) as { text?: string };
    return data.text?.trim() ?? "";
  } catch {
    return "";
  }
}

export async function runMicCall(options: {
  endpoint: string;
  phone?: string;
  handlers: MicCallHandlers;
  signal: AbortSignal;
}) {
  const { endpoint, phone, handlers, signal } = options;
  handlers.onStatus("Pidiendo micrófono…");
  const media = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const callSid = crypto.randomUUID();
  const streamSid = `MZ${callSid.replace(/-/g, "").slice(0, 32)}`;
  const fromNumber = e164(phone);
  const sinceUnix = Math.floor(Date.now() / 1000) - 5;
  let seq = 1;
  let chunk = 1;
  const outbound: string[] = [];
  let sawElevenLabs = false;
  let conversationId = "";

  async function pullTrace() {
    try {
      const query = new URLSearchParams({ callId: callSid, since: String(sinceUnix) });
      if (fromNumber) query.set("from", fromNumber);
      if (conversationId) query.set("conversationId", conversationId);
      const response = await fetch(`/api/elevenlabs/trace?${query}`);
      const data = (await response.json()) as {
        turns?: TranscriptTurn[];
        status?: string;
        conversationId?: string;
      };
      if (data.conversationId) conversationId = data.conversationId;
      if (data.turns?.length) {
        sawElevenLabs = true;
        handlers.onTrace?.(data.turns);
      }
      return data.status ?? "";
    } catch {
      return "error";
    }
  }

  handlers.onStatus("Conectando al agente…");
  const ws = new WebSocket(endpoint);

  const sendJson = (payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const sendMedia = (payload: string) => {
    sendJson({
      event: "media",
      sequenceNumber: String(seq++),
      streamSid,
      media: {
        track: "inbound",
        chunk: String(chunk++),
        timestamp: String(Date.now()),
        payload,
      },
    });
  };

  const playCtx = new AudioContext();
  let playAt = 0;
  const playPcm = (pcm8k: Int16Array) => {
    if (!pcm8k.length) return;
    const pcm = resample(pcm8k, PHONE_RATE, playCtx.sampleRate);
    const buffer = playCtx.createBuffer(1, pcm.length, playCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) data[i] = (pcm[i] ?? 0) / 32768;
    const sourceNode = playCtx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(playCtx.destination);
    const start = Math.max(playCtx.currentTime, playAt);
    sourceNode.start(start);
    playAt = start + buffer.duration;
  };

  let agentPcm = new Int16Array(0);
  let userPcm = new Int16Array(0);
  let agentQuiet: ReturnType<typeof setTimeout> | null = null;
  let userQuiet: ReturnType<typeof setTimeout> | null = null;
  let transcribing = false;

  const append = (target: Int16Array, extra: Int16Array) => {
    const next = new Int16Array(target.length + extra.length);
    next.set(target);
    next.set(extra, target.length);
    return next;
  };

  const flushAgent = () => {
    if (transcribing) return;
    const pcm = agentPcm;
    agentPcm = new Int16Array(0);
    if (rms(pcm) < 400) return;
    transcribing = true;
    handlers.onStatus("Transcribiendo al agente…");
    void transcribeRemote(pcm)
      .then((text) => {
        if (text && !sawElevenLabs) {
          handlers.onTurn({
            id: `agent-${Date.now()}`,
            kind: "message",
            role: "agent",
            text,
            source: "voice-agent",
          });
        }
      })
      .finally(() => {
        transcribing = false;
        handlers.onStatus("En llamada — habla cuando quieras");
      });
  };

  const flushUser = () => {
    const pcm = userPcm;
    userPcm = new Int16Array(0);
    if (rms(pcm) < 400) return;
    void transcribeRemote(pcm).then((text) => {
      if (text && !sawElevenLabs) {
        handlers.onTurn({
          id: `user-${Date.now()}`,
          kind: "message",
          role: "patient",
          text,
          source: "caller",
        });
      }
    });
  };

  const micCtx = new AudioContext();
  const micSource = micCtx.createMediaStreamSource(media);
  const processor = micCtx.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const pcm8 = resample(floatToPcm16(input), micCtx.sampleRate, PHONE_RATE);
    const muLaw = encodeMuLaw(pcm8);
    for (const frame of chunkBytes(muLaw, FRAME_SAMPLES)) outbound.push(bytesToB64(frame));
    if (rms(pcm8) > 500) {
      userPcm = append(userPcm, pcm8);
      if (userQuiet) clearTimeout(userQuiet);
      userQuiet = setTimeout(flushUser, 700);
    }
  };
  const mute = micCtx.createGain();
  mute.gain.value = 0;
  micSource.connect(processor);
  processor.connect(mute);
  mute.connect(micCtx.destination);

  const clock = window.setInterval(() => {
    if (signal.aborted || ws.readyState !== WebSocket.OPEN) return;
    sendMedia(outbound.shift() ?? bytesToB64(SILENCE_FRAME));
  }, 20);
  const tracer = window.setInterval(() => {
    if (signal.aborted) return;
    void pullTrace();
  }, 2000);

  ws.addEventListener("message", (event) => {
    const raw = typeof event.data === "string" ? event.data : "";
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.event === "media") {
      const payload = (msg.media as { payload?: string } | undefined)?.payload;
      if (!payload) return;
      const pcm = decodeMuLaw(b64ToBytes(payload));
      playPcm(pcm);
      agentPcm = append(agentPcm, pcm);
      if (agentQuiet) clearTimeout(agentQuiet);
      agentQuiet = setTimeout(flushAgent, 900);
      return;
    }
    if (msg.type === "tool") {
      const tool = (msg.tool ?? msg) as { name?: string; input?: unknown; output?: unknown };
      handlers.onTurn({
        id: `tool-${Date.now()}`,
        kind: "tool",
        name: String(tool.name ?? "tool"),
        reason: "El agente de voz usó esta tool",
        input:
          tool.input && typeof tool.input === "object"
            ? Object.fromEntries(
                Object.entries(tool.input as Record<string, unknown>).map(([key, value]) => [
                  key,
                  String(value),
                ]),
              )
            : {},
        result: typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output ?? ""),
      });
    }
  });

  const cleanup = () => {
    window.clearInterval(clock);
    window.clearInterval(tracer);
    if (agentQuiet) clearTimeout(agentQuiet);
    if (userQuiet) clearTimeout(userQuiet);
    try {
      sendJson({ event: "stop", streamSid, stop: { callSid } });
    } catch {
      /* ignore */
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    try {
      processor.disconnect();
      micSource.disconnect();
    } catch {
      /* ignore */
    }
    void micCtx.close();
    void playCtx.close();
    for (const track of media.getTracks()) track.stop();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
      ws.addEventListener("open", () => {
        void playCtx.resume();
        void micCtx.resume();
        sendJson({ event: "connected", protocol: "Call", version: "1.0.0" });
        sendJson({
          event: "start",
          sequenceNumber: String(seq++),
          start: {
            streamSid,
            callSid,
            tracks: ["inbound"],
            customParameters: {
              call_id: callSid,
              ...(fromNumber ? { from_number: fromNumber } : {}),
            },
          },
          streamSid,
        });
        handlers.onStatus("En llamada — habla cuando quieras");
        void pullTrace();
      });
      ws.addEventListener("error", () => reject(new Error("No se pudo abrir el WebSocket")));
      ws.addEventListener("close", () => resolve());
    });
    handlers.onStatus("Recuperando traza…");
    try {
      sendJson({ event: "stop", streamSid, stop: { callSid } });
    } catch {
      /* ignore */
    }
    for (let i = 0; i < 8; i += 1) {
      const status = await pullTrace();
      if (status === "done" && sawElevenLabs) break;
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  } finally {
    cleanup();
  }
}
