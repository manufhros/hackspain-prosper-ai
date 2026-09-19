"use client";

import {
  FRAME_SAMPLES,
  PHONE_RATE,
  SILENCE_FRAME,
  chunkBytes,
  decodeMuLaw,
  pcm16ToWav,
  resample,
  rms,
} from "@/lib/audio/phone";
import type { TranscriptTurn } from "@/lib/cases/transcript";

export type CaseCallHandlers = {
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

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runCaseCall(options: {
  caseId: string;
  endpoint: string;
  phone?: string;
  handlers: CaseCallHandlers;
  signal: AbortSignal;
}) {
  const { caseId, endpoint, phone, handlers, signal } = options;
  const callSid = crypto.randomUUID();
  const streamSid = `MZ${callSid.replace(/-/g, "").slice(0, 32)}`;
  const fromNumber = e164(phone);
  const sinceUnix = Math.floor(Date.now() / 1000) - 5;
  let seq = 1;
  let chunk = 1;
  const outbound: string[] = [];
  let sawElevenLabs = false;
  let conversationId = "";
  let history: Array<{ role: "agent" | "patient"; text: string }> = [];

  function agentLines() {
    return history.filter((turn) => turn.role === "agent").length;
  }

  function syncFromTrace(turns: TranscriptTurn[]) {
    const spoken = turns.filter(
      (turn): turn is Extract<TranscriptTurn, { kind: "message" }> => turn.kind === "message",
    );
    if (turns.some((turn) => turn.kind === "tool" || turn.kind === "message")) {
      sawElevenLabs = true;
      handlers.onTrace?.(turns);
    }
    if (!spoken.length) return;
    const elPatients = spoken.filter((turn) => turn.role === "patient").length;
    const localPatients = history.filter((turn) => turn.role === "patient").length;
    if (elPatients >= localPatients) {
      history = spoken.map((turn) => ({ role: turn.role, text: turn.text }));
      return;
    }
    const known = new Set(history.map((turn) => `${turn.role}:${turn.text}`));
    for (const turn of spoken) {
      const key = `${turn.role}:${turn.text}`;
      if (known.has(key)) continue;
      history.push({ role: turn.role, text: turn.text });
      known.add(key);
    }
  }

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
      if (data.turns?.length) syncFromTrace(data.turns);
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

  const playWav = async (wavB64: string) => {
    const bytes = b64ToBytes(wavB64);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const buffer = await playCtx.decodeAudioData(copy);
    const sourceNode = playCtx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(playCtx.destination);
    const start = Math.max(playCtx.currentTime, playAt);
    sourceNode.start(start);
    playAt = start + buffer.duration;
  };

  let inbound = new Int16Array(0);
  let lastMedia = 0;
  let collecting = false;

  const waitUtterance = (ms: number) =>
    new Promise<Int16Array>((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (signal.aborted) {
          window.clearInterval(timer);
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const quiet = Date.now() - lastMedia;
        if (collecting && inbound.length > PHONE_RATE * 0.45 && quiet > 1100) {
          window.clearInterval(timer);
          const pcm = inbound;
          inbound = new Int16Array(0);
          collecting = false;
          resolve(pcm);
          return;
        }
        const elapsed = Date.now() - started;
        const stillTalking = collecting && inbound.length > 400 && quiet < 1100;
        if (elapsed > ms + 10000 || (elapsed > ms && !stillTalking)) {
          window.clearInterval(timer);
          const pcm = inbound;
          inbound = new Int16Array(0);
          collecting = false;
          resolve(pcm);
        }
      }, 80);
    });

  const noteSpeech = (role: "agent" | "patient", text: string) => {
    if (!text) return;
    history.push({ role, text });
    if (sawElevenLabs) return;
    handlers.onTurn({
      id: `${role}-${Date.now()}`,
      kind: "message",
      role,
      text,
      source: role === "agent" ? "voice-agent" : "caller",
    });
  };

  const SPEECH_RMS = 380;

  ws.addEventListener("message", (event) => {
    const raw = typeof event.data === "string" ? event.data : "";
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.event !== "media") return;
    const payload = (msg.media as { payload?: string } | undefined)?.payload;
    if (!payload) return;
    const pcm = decodeMuLaw(b64ToBytes(payload));
    const level = rms(pcm);
    if (level > 80) playPcm(pcm);
    if (level < SPEECH_RMS) return;
    const next = new Int16Array(inbound.length + pcm.length);
    next.set(inbound);
    next.set(pcm, inbound.length);
    inbound = next;
    lastMedia = Date.now();
    collecting = true;
  });

  const clock = window.setInterval(() => {
    if (signal.aborted || ws.readyState !== WebSocket.OPEN) return;
    sendMedia(outbound.shift() ?? bytesToB64(SILENCE_FRAME));
  }, 20);
  const tracer = window.setInterval(() => {
    if (signal.aborted) return;
    void pullTrace();
  }, 2000);

  const enqueueMuLaw = (muLaw: Uint8Array) => {
    for (const frame of chunkBytes(muLaw, FRAME_SAMPLES)) outbound.push(bytesToB64(frame));
  };

  const cleanup = () => {
    window.clearInterval(clock);
    window.clearInterval(tracer);
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
    void playCtx.close();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("No se pudo abrir el WebSocket")), { once: true });
    });
    await playCtx.resume();
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
    handlers.onStatus("Esperando el saludo…");
    void pullTrace();

    const waitForAgent = async (previousAgent: number, ms: number) => {
      const deadline = Date.now() + ms;
      while (!signal.aborted && Date.now() < deadline) {
        if (agentLines() > previousAgent) return true;
        try {
          const pcm = await waitUtterance(Math.min(2500, deadline - Date.now()));
          const text = pcm.length ? await transcribeRemote(pcm) : "";
          if (text) noteSpeech("agent", text);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
        }
        await pullTrace();
        if (agentLines() > previousAgent) return true;
      }
      await pullTrace();
      return agentLines() > previousAgent;
    };

    await waitForAgent(0, 18000);

    for (let i = 0; i < 12; i += 1) {
      if (signal.aborted) break;
      handlers.onStatus("El caso está hablando…");
      const response = await fetch("/api/simulate/caller", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseId, history }),
        signal,
      });
      const data = (await response.json()) as {
        hangup?: boolean;
        text?: string;
        muLaw?: string;
        wav?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "caller tts failed");
      if (data.hangup || !data.muLaw) break;
      const spoken = data.text?.trim() ?? "";
      if (spoken) noteSpeech("patient", spoken);
      const agentsBefore = agentLines();
      enqueueMuLaw(b64ToBytes(data.muLaw));
      if (data.wav) {
        void playWav(data.wav).catch(() => undefined);
      }
      while (outbound.length && !signal.aborted) await sleep(40, signal);
      await sleep(400, signal);
      inbound = new Int16Array(0);
      collecting = false;
      lastMedia = 0;
      handlers.onStatus("Esperando al agente…");
      await waitForAgent(agentsBefore, 20000);
    }

    handlers.onStatus("Recuperando traza…");
    try {
      sendJson({ event: "stop", streamSid, stop: { callSid } });
    } catch {
      /* ignore */
    }
    for (let i = 0; i < 8; i += 1) {
      const status = await pullTrace();
      if (status === "done" && sawElevenLabs) break;
      await sleep(1000, signal).catch(() => undefined);
    }
  } finally {
    cleanup();
  }
}
