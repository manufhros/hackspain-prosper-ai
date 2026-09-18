import { type Action, type Outcome } from "./data";
import { isObject, validateAction } from "./validation";

export class CallSession {
  readonly record: Outcome = { actions: [] };
  closedAt?: number;
  constructor(readonly callId: string) {}
  close(now: number) { this.closedAt ??= now; }
  submit(callId: string, action: Action, now: number): number {
    // The deadline precedes duplicate and body checks in the published contract.
    if (this.closedAt !== undefined && now > this.closedAt + 30000) return 410;
    if (callId !== this.callId) return 404;
    if (validateAction(action).length) return 422;
    const stable = (value: unknown): string => JSON.stringify(value, (_, v) => isObject(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
    if (this.record.actions.some(a => stable(a) === stable(action))) return 409;
    this.record.actions.push(structuredClone(action));
    return 200;
  }
}
export function decodeAudio(payload: unknown): Buffer | null {
  if (typeof payload !== "string" || !payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
  const bytes = Buffer.from(payload, "base64");
  return bytes.toString("base64") === payload ? bytes : null;
}
export class WireInspector {
  callId?: string;
  streamSid?: string;
  connected = false;
  stopped = false;
  frames = 0;
  sequence = 0;
  errors: string[] = [];
  receive(raw: unknown): void {
    if (!isObject(raw)) { this.errors.push("Message must be a JSON object"); return; }
    const fail = (message: string) => this.errors.push(message);
    if (this.stopped) { fail("Message after stop"); return; }
    if (raw.event === "connected") {
      if (this.connected) fail("Duplicate connected");
      this.connected = true;
      if (raw.protocol !== "Call" || raw.version !== "1.0.0") fail("Expected Call protocol version 1.0.0");
      return;
    }
    if (!this.connected) fail("Expected connected first");
    if (typeof raw.sequenceNumber !== "string" || !/^\d+$/.test(raw.sequenceNumber)) fail("sequenceNumber must be a numeric string");
    else {
      const next = Number(raw.sequenceNumber);
      if (next !== this.sequence + 1) fail("Non-contiguous sequenceNumber");
      this.sequence = next;
    }
    if (raw.event === "start") {
      if (this.callId) fail("Duplicate start on one socket");
      const start = isObject(raw.start) ? raw.start : {};
      if (typeof start.callSid !== "string" || !start.callSid) fail("start.callSid required");
      else this.callId = start.callSid;
      if (typeof raw.streamSid !== "string" || !raw.streamSid) fail("streamSid required");
      else this.streamSid = raw.streamSid;
      if (start.streamSid !== raw.streamSid) fail("start.streamSid mismatch");
      const format = isObject(start.mediaFormat) ? start.mediaFormat : {};
      if (format.encoding !== "audio/x-mulaw" || format.sampleRate !== 8000 || format.channels !== 1) fail("Expected mono 8 kHz audio/x-mulaw");
      if (isObject(start.customParameters) && start.customParameters.call_id !== undefined && start.customParameters.call_id !== start.callSid) fail("customParameters.call_id differs from callSid");
    } else {
      if (!this.callId) fail("Expected start before media/stop");
      if (raw.streamSid !== this.streamSid) fail("Cross-call streamSid mismatch");
      if (raw.event === "media") {
        const media = isObject(raw.media) ? raw.media : {};
        for (const key of ["chunk", "timestamp"]) if (typeof media[key] !== "string" || !/^\d+$/.test(media[key] as string)) fail(`media.${key} must be a numeric string`);
        if (decodeAudio(media.payload)?.length !== 160) fail("Inbound frame must contain 160 mu-law bytes (20 ms)");
        this.frames++;
      } else if (raw.event === "stop") this.stopped = true;
      else if (raw.event !== "mark") fail(`Unsupported inbound event: ${String(raw.event)}`);
    }
  }
  finish() {
    return { call_id: this.callId, frames: this.frames, stopped: this.stopped,
      errors: [...this.errors, ...(!this.callId ? ["Missing start"] : []), ...(!this.stopped ? ["Missing stop (trace may be incomplete)"] : [])] };
  }
}
export function inspectTrace(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Trace must be an array of { connection, message } inbound events");
  const sessions = new Map<string, WireInspector>();
  for (const row of value) {
    if (!isObject(row) || typeof row.connection !== "string" || !("message" in row)) throw new Error("Every event needs connection and message");
    if (!sessions.has(row.connection)) sessions.set(row.connection, new WireInspector());
    sessions.get(row.connection)!.receive(row.message);
  }
  const calls = [...sessions].map(([connection, inspector]) => ({ connection, ...inspector.finish() }));
  const counts = new Map<string, number>();
  for (const c of calls) if (c.call_id) counts.set(c.call_id, (counts.get(c.call_id) ?? 0) + 1);
  for (const c of calls) if (c.call_id && counts.get(c.call_id)! > 1) c.errors.push("callSid reused across connections");
  return { label: "Inbound wire validation only; no voice or scheduling verdict", calls, valid: calls.length > 0 && calls.every(c => c.errors.length === 0) };
}
export function wireMessages(callId: string, streamSid: string) {
  return {
    connected: { event: "connected", protocol: "Call", version: "1.0.0" },
    start: { event: "start", sequenceNumber: "1", streamSid,
      start: { accountSid: "AC-workbench", streamSid, callSid: callId, tracks: ["inbound"],
        mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 }, customParameters: { call_id: callId } } },
    media: (index: number) => ({ event: "media", sequenceNumber: String(index + 2), streamSid,
      media: { track: "inbound", chunk: String(index + 1), timestamp: String(index * 20), payload: Buffer.alloc(160, 0xff).toString("base64") } }),
    stop: (frames: number) => ({ event: "stop", sequenceNumber: String(frames + 2), streamSid, stop: { accountSid: "AC-workbench", callSid: callId } }),
  };
}
export async function probeEndpoint(endpoint: string, count: number, signal?: AbortSignal) {
  const url = new URL(endpoint);
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use a ws:// or wss:// endpoint without embedded credentials/query/fragment");
  if (![1, 5, 10, 20].includes(count)) throw new Error("Choose 1, 5, 10 or 20 connections");
  if (signal?.aborted) throw new Error("Probe cancelled");
  const calls = await Promise.all(Array.from({ length: count }, (_, index) => new Promise<{
    call_id: string; connected: boolean; outbound_bytes: number; non_silence_bytes: number; errors: string[];
  }>(resolve => {
    const callId = `workbench-${crypto.randomUUID()}`;
    const stream = `MZ-workbench-${index}`;
    const wire = wireMessages(callId, stream);
    const result = { call_id: callId, connected: false, outbound_bytes: 0, non_silence_bytes: 0, errors: [] as string[] };
    const socket = new WebSocket(url);
    let frame = 0, finished = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout); clearInterval(interval);
      signal?.removeEventListener("abort", abort);
      if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(wire.stop(frame))); socket.close(); }
      else if (socket.readyState === WebSocket.CONNECTING) socket.close();
      resolve(result);
    };
    const abort = () => { result.errors.push("Cancelled"); finish(); };
    const timeout = setTimeout(() => { if (!result.connected) result.errors.push("Connection timeout"); finish(); }, 5000);
    signal?.addEventListener("abort", abort, { once: true });
    socket.onopen = () => {
      result.connected = true;
      socket.send(JSON.stringify(wire.connected)); socket.send(JSON.stringify(wire.start));
      interval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN && frame < 50) socket.send(JSON.stringify(wire.media(frame++)));
        if (frame === 50) clearInterval(interval);
      }, 20);
    };
    socket.onmessage = event => {
      if (finished) return;
      try {
        const message: unknown = JSON.parse(String(event.data));
        if (!isObject(message) || message.streamSid !== stream) throw new Error("Outbound streamSid mismatch");
        if (message.event === "media") {
          const bytes = decodeAudio(isObject(message.media) ? message.media.payload : undefined);
          if (!bytes) throw new Error("Invalid outbound base64 audio");
          result.outbound_bytes += bytes.length;
          result.non_silence_bytes += bytes.filter(byte => byte !== 0xff && byte !== 0x7f).length;
        } else if (!["mark", "clear"].includes(String(message.event))) throw new Error("Unexpected outbound event");
      } catch (error) { if (result.errors.length < 20) result.errors.push(error instanceof Error ? error.message : "Malformed outbound message"); }
    };
    socket.onerror = () => { result.errors.push("WebSocket connection error"); finish(); };
    socket.onclose = () => { if (!finished) { result.errors.push("Endpoint closed before probe completed"); finish(); } };
  })));
  return { label: "Transport probe only: 1s silence per socket, 5s observation. Synthetic IDs cannot be submitted to Prosper.",
    limitations: "No spoken caller, speech recognition, noise, barge-in, scheduling, or semantic isolation test. Non-silence bytes do not prove intelligible speech.", calls };
}
