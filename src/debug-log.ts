export type TraceEvent = {
  t: string;
  source: "in" | "out" | "sys";
  type: string;
  stage?: string;
  message?: string;
  ms?: number;
  data?: unknown;
};

export type CallTrace = {
  id: string;
  kind: "web" | "twilio";
  startedAt: string;
  endedAt?: string;
  lastError?: string;
  events: TraceEvent[];
};

const MAX_CALLS = 40;
const MAX_EVENTS = 250;
const calls: CallTrace[] = [];
const bySocket = new Map<string, string>();

function slim(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const rec = data as Record<string, unknown>;
  if (typeof rec.data === "string" && rec.data.length > 80) {
    return { ...rec, data: `[base64 ${rec.data.length} chars]` };
  }
  if (typeof rec.pcm === "string") {
    return { type: rec.type, sampleRate: rec.sampleRate, pcmBytes: rec.pcm.length };
  }
  return data;
}

export function beginCall(socketKey: string, kind: CallTrace["kind"]): CallTrace {
  const trace: CallTrace = {
    id: socketKey,
    kind,
    startedAt: new Date().toISOString(),
    events: [],
  };
  bySocket.set(socketKey, socketKey);
  calls.unshift(trace);
  while (calls.length > MAX_CALLS) calls.pop();
  push(socketKey, {
    t: trace.startedAt,
    source: "sys",
    type: "open",
    stage: "ws",
    message: `socket ${kind} abierto`,
  });
  return trace;
}

export function renameCall(socketKey: string, callId: string) {
  const current = bySocket.get(socketKey);
  const trace = calls.find((c) => c.id === current);
  if (!trace) return;
  trace.id = callId;
  bySocket.set(socketKey, callId);
}

export function endCall(socketKey: string) {
  const id = bySocket.get(socketKey);
  const trace = calls.find((c) => c.id === id);
  if (!trace || trace.endedAt) return;
  trace.endedAt = new Date().toISOString();
  push(socketKey, {
    t: trace.endedAt,
    source: "sys",
    type: "close",
    stage: "ws",
    message: "socket cerrado",
  });
}

export function push(socketKey: string, event: TraceEvent) {
  const id = bySocket.get(socketKey) ?? socketKey;
  const trace = calls.find((c) => c.id === id);
  if (!trace) return;
  const next = { ...event, data: slim(event.data) };
  trace.events.push(next);
  if (trace.events.length > MAX_EVENTS) trace.events.splice(0, trace.events.length - MAX_EVENTS);
  if (event.type === "error" || event.stage === "error") {
    trace.lastError = event.message;
  }
}

export function dumpDebug() {
  return {
    now: new Date().toISOString(),
    calls: calls.map((call) => ({
      ...call,
      eventCount: call.events.length,
    })),
  };
}
