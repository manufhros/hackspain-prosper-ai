import type { TranscriptTurn } from "@/lib/cases/transcript";
import { FRAME_SAMPLES, SILENCE_FRAME, chunkBytes, decodeMuLaw } from "@/lib/audio/phone";
import { nextCallerLine, speakMuLaw, transcribePcm } from "@/lib/voice/speech";
import type { PublicCase } from "@/lib/cases/types";

export type VoiceSimEvent =
  | { type: "status"; status: string }
  | { type: "turn"; turn: TranscriptTurn }
  | { type: "error"; error: string }
  | { type: "done" };

function e164(phone?: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("34")) return `+${digits}`;
  if (digits.length === 9) return `+34${digits}`;
  return `+${digits}`;
}

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function asFields(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );
}

export async function runVoiceCall(options: {
  item: PublicCase;
  endpoint: string;
  emit: (event: VoiceSimEvent) => void;
  signal: AbortSignal;
}) {
  const { item, endpoint, emit, signal } = options;
  const callSid = crypto.randomUUID();
  const streamSid = `MZ${callSid.replace(/-/g, "").slice(0, 32)}`;
  const fromNumber = e164(item.persona.phone ?? item.persona.data.phone);
  const history: Array<{ role: "agent" | "patient"; text: string }> = [];
  let seq = 1;
  let chunk = 1;
  let inbound = new Int16Array(0);
  let lastMedia = 0;
  let collecting = false;

  emit({ type: "status", status: `Conectando a ${endpoint}` });

  const ws = new WebSocket(endpoint);
  const sendJson = (payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };
  const mediaMsg = (payload: string) => {
    sendJson({
      event: "media",
      sequenceNumber: String(seq++),
      streamSid,
      media: { track: "inbound", chunk: String(chunk++), timestamp: String(Date.now()), payload },
    });
  };

  const queue: string[] = [];
  const clock = setInterval(() => {
    if (signal.aborted || ws.readyState !== WebSocket.OPEN) return;
    mediaMsg(queue.shift() ?? b64(SILENCE_FRAME));
  }, 20);

  const enqueueMuLaw = (muLaw: Uint8Array) => {
    for (const frame of chunkBytes(muLaw, FRAME_SAMPLES)) queue.push(b64(frame));
  };

  const waitOpen = () =>
    new Promise<void>((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("No se pudo abrir el WebSocket")), { once: true });
    });

  const waitUtterance = (ms: number) =>
    new Promise<Int16Array>((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (signal.aborted) {
          clearInterval(timer);
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const quiet = Date.now() - lastMedia;
        if (collecting && inbound.length > 1600 && quiet > 900) {
          clearInterval(timer);
          const pcm = inbound;
          inbound = new Int16Array(0);
          collecting = false;
          resolve(pcm);
          return;
        }
        if (Date.now() - started > ms) {
          clearInterval(timer);
          const pcm = inbound;
          inbound = new Int16Array(0);
          collecting = false;
          resolve(pcm);
        }
      }, 80);
    });

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
      const bytes = Uint8Array.from(Buffer.from(payload, "base64"));
      const pcm = decodeMuLaw(bytes);
      const next = new Int16Array(inbound.length + pcm.length);
      next.set(inbound);
      next.set(pcm, inbound.length);
      inbound = next;
      lastMedia = Date.now();
      collecting = true;
      return;
    }
    if (msg.type === "tool") {
      const tool = (msg.tool ?? msg) as { name?: string; input?: unknown; output?: unknown };
      emit({
        type: "turn",
        turn: {
          id: `tool-${Date.now()}`,
          kind: "tool",
          name: String(tool.name ?? "tool"),
          reason: "El agente de voz usó esta tool",
          input: asFields(tool.input),
          result: typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output ?? ""),
        },
      });
    }
    if (msg.type === "transcript" && typeof msg.text === "string") {
      const role = msg.role === "user" || msg.role === "patient" ? "patient" : "agent";
      history.push({ role, text: msg.text });
      emit({
        type: "turn",
        turn: { id: `t-${Date.now()}`, kind: "message", role, text: msg.text, source: role === "agent" ? "voice-agent" : "caller" },
      });
    }
  });

  try {
    await waitOpen();
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
    emit({ type: "status", status: "En llamada con el agente de voz" });

    const greeting = await waitUtterance(15000);
    const greetingText = greeting.length ? await transcribePcm(greeting) : "";
    if (greetingText) {
      history.push({ role: "agent", text: greetingText });
      emit({
        type: "turn",
        turn: { id: `t-${history.length}`, kind: "message", role: "agent", text: greetingText, source: "voice-agent" },
      });
    }

    const maxTurns = 12;
    for (let i = 0; i < maxTurns; i++) {
      if (signal.aborted) break;
      emit({ type: "status", status: "El llamante está pensando…" });
      const spoken = await nextCallerLine({
        callerPrompt: item.caller_prompt,
        language: item.language,
        history,
      });
      if (spoken.includes("[HANGUP]")) break;
      history.push({ role: "patient", text: spoken });
      emit({
        type: "turn",
        turn: { id: `t-${history.length}`, kind: "message", role: "patient", text: spoken, source: "caller" },
      });
      emit({ type: "status", status: "El llamante está hablando…" });
      enqueueMuLaw(await speakMuLaw(spoken, item.persona.voice === "male" ? "onyx" : "alloy"));
      while (queue.length && !signal.aborted) await new Promise((r) => setTimeout(r, 40));
      emit({ type: "status", status: "Esperando al agente…" });
      const replyPcm = await waitUtterance(18000);
      const reply = replyPcm.length ? await transcribePcm(replyPcm) : "";
      if (!reply) continue;
      history.push({ role: "agent", text: reply });
      emit({
        type: "turn",
        turn: { id: `t-${history.length}`, kind: "message", role: "agent", text: reply, source: "voice-agent" },
      });
    }

    sendJson({ event: "stop", streamSid, stop: { callSid } });
    emit({ type: "done" });
  } finally {
    clearInterval(clock);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}
