import { decodeAudio, wireMessages } from "../protocol";
import { isObject } from "../validation";
import { delay, frameEnergy, defaultVad } from "../telephony/audio";
import type { SpeechDetector } from "../telephony/silero";
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
  get pendingAudioBytes() { return this.receivedBytes; }
  takeAudio(): Buffer | undefined {
    const audio = Buffer.concat(this.received); this.received = []; this.receivedBytes = 0;
    return audio.length ? audio : undefined;
  }
  retainAudio(bytes: number) {
    if (this.receivedBytes <= bytes) return;
    const tail = Buffer.concat(this.received).subarray(-bytes);
    this.received = [Buffer.from(tail)]; this.receivedBytes = tail.length;
  }
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
  acknowledgeMark(raw: unknown) {
    if (!isObject(raw) || raw.streamSid !== this.streamSid || raw.event !== "mark"
      || !isObject(raw.mark) || typeof raw.mark.name !== "string") throw new Error("Invalid receptionist mark");
    this.message("mark", { mark: { name: raw.mark.name } });
  }
  receive(raw: unknown, acknowledgeMark = true): Buffer | undefined {
    if (!isObject(raw) || raw.streamSid !== this.streamSid) throw new Error("Malformed or cross-call response from receptionist");
    if (raw.event === "media") {
      const audio = decodeAudio(isObject(raw.media) ? raw.media.payload : undefined);
      if (!audio || (this.receivedBytes += audio.length) > 480000) throw new Error("Invalid or oversized receptionist audio");
      this.received.push(audio);
      this.monitor?.("agent", audio);
    } else if (raw.event === "mark") {
      if (!isObject(raw.mark) || typeof raw.mark.name !== "string") throw new Error("Invalid receptionist mark");
      if (acknowledgeMark) this.acknowledgeMark(raw);
      return this.takeAudio();
    } else if (raw.event !== "clear") throw new Error("Unknown receptionist wire event");
    // Like the published harness, clear does not discard audio already received.
  }
  stop() { this.message("stop", { stop: { accountSid: "AC-workbench", callSid: this.callId } }); }
}

export interface CallerEvent { role: "caller" | "heard_agent"; text: string; at_ms: number; processing_ms: number; audio_files?: string[] }
export interface CallResult {
  call_id: string; elapsed_ms: number; close_code?: number; events: CallerEvent[]; errors: string[];
  wire_stats?: { received_audio_bytes: number; received_marks: number; turns_without_marks: number; speech_frames?: number };
}
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
  progress?: (message: string) => void;
  timing?: { greetingMs?: number; turnSilenceMs?: number };
  speechDetector?: SpeechDetector;
  connect?: (url: string, options: Bun.WebSocketOptions) => WebSocket;
}): Promise<CallResult> {
  const { inference, item } = options;
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal, AbortSignal.timeout(180000)]);
  const started = performance.now(), events: CallerEvent[] = [], errors: string[] = [];
  const progress = (message: string) => options.progress?.(`${Math.round(performance.now() - started)}ms: ${message}`);
  const stats = { received_audio_bytes: 0, received_marks: 0, turns_without_marks: 0, speech_frames: 0 };
  let greeting: ReturnType<typeof setTimeout> | undefined, turnEnd: ReturnType<typeof setTimeout> | undefined;
  let playbackUntil = 0, speechDeadline = 0, bufferHasSpeech = false;
  let vadRemainder: Buffer = Buffer.alloc(0), receiving = Promise.resolve(), pendingMessages = 0;
  let closed = false, closeCode: number | undefined, turns = 0, processing = Promise.resolve(), pump = Promise.resolve();
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  // lib.dom's constructor hides Bun's documented headers overload in this project.
  const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  const connect = options.connect ?? ((url, settings) => new BunWebSocket(url, settings));
  progress("Connecting WebSocket");
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
    clearTimeout(greeting); clearTimeout(turnEnd);
    if (socket.readyState === WebSocket.OPEN) wire.stop();
    closed = true; socket.close(1000, "Simulator finished"); finish();
  };
  const fail = (error: unknown) => {
    errors.push(error instanceof Error ? error.message : String(error));
    progress(`Call failed: ${errors.at(-1)}`);
    stop(); lifetime.abort();
  };
  const onAbort = () => { if (!closed) fail(signal.reason); };
  signal.addEventListener("abort", onAbort, { once: true });
  const handshake = setTimeout(() => fail(new Error("WebSocket did not open within 10 seconds")), 10000);
  async function speakReply(beginning: number, opening = false) {
    progress(opening ? "Generating caller opening request" : "Generating caller reply");
    const reply = await inference.chat(history, [], signal, responseSchema);
    const response = callerResponse(reply.message.content);
    if (closed) return;
    if (response.wait) {
      history.push({ role: "assistant", content: reply.message.content });
      progress("Caller is waiting for the receptionist to continue");
      return;
    }
    // A delayed greeting may arrive while the opening request is being generated.
    if (opening && stats.speech_frames) return;
    if (++turns > 24) throw new Error("Caller exceeded 24 spoken turns");
    progress("Synthesizing caller speech");
    const speech = await inference.audio("speak", { text: response.speech, language: item.language, wire: true }, signal);
    if (closed || (opening && stats.speech_frames)) return;
    const raw = decodeAudio(speech.payload);
    if (!raw) throw new Error("Caller TTS returned invalid audio");
    const files = await options.saveAudio("caller", raw);
    if (closed || (opening && stats.speech_frames)) return;
    history.push({ role: "assistant", content: reply.message.content });
    emit({ role: "caller", text: response.speech, at_ms: Math.round(performance.now() - started),
      processing_ms: Math.round(performance.now() - beginning), audio_files: files });
    wire.play(raw);
    while (wire.playing && !closed) await delay(20, signal);
    // Keep real silence on the wire so the receptionist's normal VAD finalizes the utterance.
    if (!closed) { progress("Waiting for receptionist audio"); await delay(600, signal); }
  }
  async function respond(audio: Buffer) {
    const beginning = performance.now();
    progress(`Transcribing ${(audio.length / 8000).toFixed(2)}s of receptionist audio`);
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
    await speakReply(beginning);
  }
  function enqueueAudio(audio: Buffer | undefined) {
    if (audio) processing = processing.then(() => respond(audio)).catch(fail);
  }
  function flushUnmarkedAudio() {
    clearTimeout(turnEnd);
    const audio = wire.takeAudio();
    const speech = bufferHasSpeech; bufferHasSpeech = false;
    if (!audio || !speech) return;
    stats.turns_without_marks++;
    progress("Receptionist audio ended without a mark; processing buffered turn");
    enqueueAudio(audio);
  }
  function scheduleTurnEnd() {
    clearTimeout(turnEnd);
    if (!bufferHasSpeech || closed) return;
    turnEnd = setTimeout(() => {
      // Finish inspecting frames already received before deciding that speech ended.
      receiving = receiving.then(() => {
        if (closed || !bufferHasSpeech) return;
        if (performance.now() < speechDeadline) scheduleTurnEnd();
        else flushUnmarkedAudio();
      }).catch(fail);
    }, Math.max(0, speechDeadline - performance.now()));
  }
  const diagnostics = setInterval(() => {
    if (!closed) progress(`Received ${(stats.received_audio_bytes / 8000).toFixed(1)}s audio; detected ${(stats.speech_frames * 0.02).toFixed(1)}s speech; ${stats.received_marks} marks; ${(wire.pendingAudioBytes / 8000).toFixed(1)}s buffered`);
  }, 5000);
  socket.onopen = () => {
    clearTimeout(handshake);
    if (signal.aborted) { onAbort(); return; }
    progress("WebSocket connected; sending start and waiting for receptionist audio");
    const digits = String(item.persona.data.phone ?? "").replace(/\D/g, "");
    wire.start(digits.length === 9 ? `+34${digits}` : digits.length === 11 && digits.startsWith("34") ? `+${digits}` : undefined);
    greeting = setTimeout(() => {
      if (closed || stats.speech_frames) return;
      progress("No receptionist greeting; caller will speak first");
      processing = processing.then(async () => {
        if (closed || stats.speech_frames) return;
        history.push({ role: "user", content: "[The phone is connected, but the receptionist has not spoken. Start the call now with a brief greeting and your request. Do not wait silently.]" });
        await speakReply(performance.now(), true);
      }).catch(fail);
    }, options.timing?.greetingMs ?? 3000);
    pump = (async () => { while (!closed) { wire.tick(); await delay(20, signal); } })().catch(error => { if (!closed) fail(error); });
  };
  socket.onmessage = message => {
    try {
      if (closed) return;
      const raw = JSON.parse(String(message.data));
      // Do not delay the protocol acknowledgement behind neural audio analysis.
      if (isObject(raw) && raw.event === "mark") wire.acknowledgeMark(raw);
      const arrived = performance.now();
      if (++pendingMessages > 3000) throw new Error("Receptionist audio analysis queue is full");
      receiving = receiving.then(async () => {
        if (signal.aborted) return;
        const audio = wire.receive(raw, false);
        if (raw.event === "media") {
          const bytes = decodeAudio(raw.media.payload)!;
          if (!stats.received_audio_bytes) progress("Receiving receptionist audio");
          stats.received_audio_bytes += bytes.length;
          const startAt = Math.max(arrived, playbackUntil);
          playbackUntil = startAt + bytes.length / 8;
          const prior = vadRemainder.length, frames = Buffer.concat([vadRemainder, bytes]);
          let offset = 0, lastSpeechEnd = -1;
          for (; offset + 160 <= frames.length; offset += 160) {
            const frame = frames.subarray(offset, offset + 160);
            const speech = options.speechDetector ? await options.speechDetector.push(frame) : frameEnergy(frame) >= defaultVad.threshold;
            if (speech) { stats.speech_frames++; lastSpeechEnd = offset + 160 - prior; }
          }
          vadRemainder = Buffer.from(frames.subarray(offset));
          if (lastSpeechEnd >= 0) {
            clearTimeout(greeting);
            if (!bufferHasSpeech) progress("Detected receptionist speech");
            bufferHasSpeech = true;
            speechDeadline = startAt + lastSpeechEnd / 8 + (options.timing?.turnSilenceMs ?? 1200);
            scheduleTurnEnd();
          } else if (!bufferHasSpeech) {
            // Keep a 200 ms lead-in, but never accumulate an endless background track.
            wire.retainAudio(1600);
          }
        } else if (raw.event === "mark") {
          stats.received_marks++;
          playbackUntil = 0;
          clearTimeout(turnEnd);
          if (bufferHasSpeech) enqueueAudio(audio);
          bufferHasSpeech = false;
        }
      }).catch(fail).finally(() => { pendingMessages--; });
    } catch (error) { fail(error); }
  };
  socket.onerror = () => fail(new Error("WebSocket connection failed; check the endpoint and its authentication"));
  socket.onclose = event => {
    const stopped = closed;
    closeCode = event.code; closed = true;
    clearTimeout(greeting); clearTimeout(turnEnd);
    progress(`WebSocket closed (code ${event.code})`);
    void receiving.then(() => {
      if (!stopped && !signal.aborted) flushUnmarkedAudio();
      finish();
    });
  };
  try {
    if (signal.aborted) onAbort();
    await done;
    clearTimeout(handshake);
    await receiving;
    await processing;
  } finally {
    signal.removeEventListener("abort", onAbort); clearTimeout(handshake); clearTimeout(greeting); clearTimeout(turnEnd); clearInterval(diagnostics);
    options.speechDetector?.reset();
    closed = true; lifetime.abort(); socket.close(); await pump;
  }
  return { call_id: options.callId, elapsed_ms: Math.round(performance.now() - started), close_code: closeCode, events, errors, wire_stats: stats };
}
