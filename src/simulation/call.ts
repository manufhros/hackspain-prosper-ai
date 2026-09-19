import { decodeAudio, wireMessages } from "../protocol";
import { isObject } from "../validation";
import { delay } from "../telephony/audio";
import type { Inference } from "../voice/runtime";
import type { PublicCase } from "../data";
import { simulatedCallerMessages } from "./scenario";
import type { AudioLane } from "./playback";

export function websocketTarget(endpoint: string): string {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Expected a valid ws:// or wss:// URL"); }
  if (!["ws:", "wss:"].includes(url.protocol) || url.hash || url.username || url.password)
    throw new Error("Expected a ws:// or wss:// URL without embedded credentials or a fragment");
  return url.href;
}

export function localTarget(endpoint: string): { socket: string; health: string } {
  const url = new URL(endpoint);
  if (url.protocol !== "ws:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.pathname !== "/ws" || url.search || url.hash || url.username || url.password)
    throw new Error("Simulator requires a local ws://127.0.0.1:<port>/ws endpoint and reports in this checkout.");
  const health = new URL(url); health.protocol = "http:"; health.pathname = "/healthz";
  return { socket: url.href, health: health.href };
}
export function requireDryRun(health: unknown) {
  if (!isObject(health) || health.mode !== "dry_run")
    throw new Error("Restart the receptionist yourself with: bun run serve --dry-run (synthetic call IDs cannot be submitted to Prosper).");
  if (health.ready !== true) throw new Error("Receptionist is not ready yet; wait for Ready before retrying.");
}

/** One tick = one 20 ms frame, including silence. A single counter includes mark acknowledgements. */
export class CallerWire {
  private sequence = 1;
  private frames = 0;
  private speech: Buffer = Buffer.alloc(0);
  private offset = 0;
  private received: Buffer[] = [];
  private receivedBytes = 0;
  constructor(readonly callId: string, readonly streamSid: string, private send: (data: string) => void,
    private monitor?: (role: AudioLane, audio: Buffer) => void) {}
  get playing() { return this.offset < this.speech.length; }
  start(phone?: string) {
    const messages = wireMessages(this.callId, this.streamSid);
    this.send(JSON.stringify(messages.connected));
    const customParameters = { ...messages.start.start.customParameters, ...(phone ? { from_number: phone } : {}) };
    this.send(JSON.stringify({ ...messages.start, start: { ...messages.start.start, customParameters } }));
  }
  private message(event: string, fields: Record<string, unknown>) {
    this.send(JSON.stringify({ event, sequenceNumber: String(++this.sequence), streamSid: this.streamSid, ...fields }));
  }
  play(audio: Buffer) {
    if (this.playing) throw new Error("Caller attempted overlapping speech");
    if (!audio.length || audio.length > 160000) throw new Error("Caller speech must be between 0 and 20 seconds");
    this.speech = audio; this.offset = 0;
  }
  tick() {
    const frame = Buffer.alloc(160, 0xff);
    if (this.playing) { this.speech.copy(frame, 0, this.offset, this.offset + 160); this.offset += 160; }
    this.message("media", { media: { track: "inbound", chunk: String(this.frames + 1), timestamp: String(this.frames * 20), payload: frame.toString("base64") } });
    this.monitor?.("caller", frame);
    this.frames++;
  }
  receive(raw: unknown): Buffer | undefined {
    if (!isObject(raw) || raw.streamSid !== this.streamSid) throw new Error("Malformed or cross-call response from receptionist");
    if (raw.event === "media") {
      const audio = decodeAudio(isObject(raw.media) ? raw.media.payload : undefined);
      if (!audio || (this.receivedBytes += audio.length) > 480000) throw new Error("Invalid or oversized receptionist audio");
      this.received.push(audio);
      this.monitor?.("agent", audio);
    } else if (raw.event === "mark") {
      if (!isObject(raw.mark) || typeof raw.mark.name !== "string") throw new Error("Invalid receptionist mark");
      this.message("mark", { mark: { name: raw.mark.name } });
      const audio = Buffer.concat(this.received); this.received = []; this.receivedBytes = 0;
      return audio.length ? audio : undefined;
    } else if (raw.event !== "clear") throw new Error("Unknown receptionist wire event");
    // Like the published harness, clear does not discard audio already received.
  }
  stop() { this.message("stop", { stop: { accountSid: "AC-workbench", callSid: this.callId } }); }
}

export interface CallerEvent { role: "caller" | "heard_agent"; text: string; at_ms: number; processing_ms: number; audio_files?: string[] }
export interface CallResult { call_id: string; elapsed_ms: number; close_code?: number; events: CallerEvent[]; errors: string[] }
const responseSchema = { type: "object", properties: { speech: { type: "string" }, wait: { type: "boolean" } }, required: ["speech", "wait"] };
export function callerResponse(content: string): { speech: string; wait: boolean } {
  const value: unknown = JSON.parse(content);
  if (!isObject(value) || typeof value.speech !== "string" || typeof value.wait !== "boolean"
    || value.speech.length > 450 || (value.wait ? !!value.speech.trim() : !value.speech.trim()))
    throw new Error("Caller model returned invalid speech/wait response");
  return { speech: value.speech, wait: value.wait };
}

export async function runSimulatedCall(options: {
  endpoint: string; token?: string; callId: string; item: PublicCase; inference: Inference; signal: AbortSignal;
  update: (event: CallerEvent) => void;
  saveAudio: (role: string, audio: Buffer) => Promise<string[]>;
  monitor?: (role: AudioLane, audio: Buffer) => void;
  connect?: (url: string, options: Bun.WebSocketOptions) => WebSocket;
}): Promise<CallResult> {
  const { inference, item } = options;
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal, AbortSignal.timeout(180000)]);
  const started = performance.now(), events: CallerEvent[] = [], errors: string[] = [];
  let closed = false, closeCode: number | undefined, turns = 0, processing = Promise.resolve(), pump = Promise.resolve();
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  // lib.dom's constructor hides Bun's documented headers overload in this project.
  const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  const connect = options.connect ?? ((url, settings) => new BunWebSocket(url, settings));
  const socket = connect(websocketTarget(options.endpoint), {
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
  });
  const wire = new CallerWire(options.callId, `MS-${crypto.randomUUID()}`, data => {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }, options.monitor);
  const history = simulatedCallerMessages(item);
  const emit = (event: CallerEvent) => { events.push(event); options.update(event); };
  const stop = () => {
    if (closed) return;
    if (socket.readyState === WebSocket.OPEN) wire.stop();
    closed = true; socket.close(1000, "Simulator finished"); finish();
  };
  const fail = (error: unknown) => {
    errors.push(error instanceof Error ? error.message : String(error));
    stop(); lifetime.abort();
  };
  const onAbort = () => { if (!closed) fail(signal.reason); };
  signal.addEventListener("abort", onAbort, { once: true });
  const handshake = setTimeout(() => fail(new Error("WebSocket did not open within 10 seconds")), 10000);
  async function respond(audio: Buffer) {
    const beginning = performance.now();
    const audioFiles = await options.saveAudio("agent", audio);
    const parts: string[] = [];
    // ASR input is bounded to 30s, while a complete receptionist turn may be 60s.
    for (let offset = 0; offset < audio.length; offset += 240000) {
      const heard = await inference.audio("transcribe_mulaw", { payload: audio.subarray(offset, offset + 240000).toString("base64") }, signal);
      parts.push(heard.text ?? "");
    }
    const heard = parts.join(" ").trim();
    emit({ role: "heard_agent", text: heard, at_ms: Math.round(performance.now() - started),
      processing_ms: Math.round(performance.now() - beginning), audio_files: audioFiles });
    if (closed) return;
    history.push({ role: "user", content: heard || "[The line was unintelligible. Ask for repetition.]" });
    const reply = await inference.chat(history, [], signal, responseSchema);
    const response = callerResponse(reply.message.content);
    history.push({ role: "assistant", content: reply.message.content });
    if (closed || response.wait) return;
    if (++turns > 24) throw new Error("Caller exceeded 24 spoken turns");
    const speech = await inference.audio("speak", { text: response.speech, language: item.language, wire: true }, signal);
    if (closed) return;
    const raw = decodeAudio(speech.payload);
    if (!raw) throw new Error("Caller TTS returned invalid audio");
    const files = await options.saveAudio("caller", raw);
    emit({ role: "caller", text: response.speech, at_ms: Math.round(performance.now() - started),
      processing_ms: Math.round(performance.now() - beginning), audio_files: files });
    wire.play(raw);
    while (wire.playing && !closed) await delay(20, signal);
    // Keep real silence on the wire so the receptionist's normal VAD finalizes the utterance.
    if (!closed) await delay(600, signal);
  }
  socket.onopen = () => {
    clearTimeout(handshake);
    if (signal.aborted) { onAbort(); return; }
    const digits = String(item.persona.data.phone ?? "").replace(/\D/g, "");
    wire.start(digits.length === 9 ? `+34${digits}` : digits.length === 11 && digits.startsWith("34") ? `+${digits}` : undefined);
    pump = (async () => { while (!closed) { wire.tick(); await delay(20, signal); } })().catch(error => { if (!closed) fail(error); });
  };
  socket.onmessage = message => {
    try {
      if (closed) return;
      const audio = wire.receive(JSON.parse(String(message.data)));
      if (audio) processing = processing.then(() => respond(audio)).catch(error => { fail(error); });
    } catch (error) { fail(error); }
  };
  socket.onerror = () => fail(new Error("WebSocket connection failed; check the endpoint and its authentication"));
  socket.onclose = event => { closeCode = event.code; closed = true; finish(); };
  try {
    if (signal.aborted) onAbort();
    await done;
    clearTimeout(handshake);
    await processing;
  } finally {
    signal.removeEventListener("abort", onAbort); clearTimeout(handshake);
    closed = true; lifetime.abort(); socket.close(); await pump;
  }
  return { call_id: options.callId, elapsed_ms: Math.round(performance.now() - started), close_code: closeCode, events, errors };
}
