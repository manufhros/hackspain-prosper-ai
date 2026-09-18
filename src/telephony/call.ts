import { type Outcome } from "../data";
import { decodeAudio, WireInspector } from "../protocol";
import { isObject } from "../validation";
import { Receptionist, type ClinicReader, type TraceEvent } from "../voice/agent";
import { type Inference } from "../voice/runtime";
import { delay, SharedAudio, VoiceActivity, type VadOptions } from "./audio";
import { ResolutionSubmitter, type SubmissionReceipt } from "./submission";

export interface CallSocket { send(message: string): number; close(code: number, reason: string): void }
export interface CallIdentity { session_id: string; call_id?: string }
export interface PlatformCallReport {
  session_id: string; call_id?: string; stream_sid?: string; mode: "platform" | "dry_run";
  reference_time: string; elapsed_ms: number; status: "completed" | "ended" | "error";
  record?: Outcome; submissions: SubmissionReceipt[]; transcript: Receptionist["transcript"];
  events: TraceEvent[]; errors: string[];
}
export interface CallOptions {
  inference: Inference; audio: SharedAudio; clinic: ClinicReader; socket: CallSocket;
  lifetime: AbortSignal; live: boolean; language: string; vad: VadOptions;
  claim(callId: string): boolean;
  report(report: PlatformCallReport): Promise<void>;
  onEvent?(call: CallIdentity, event: TraceEvent): void;
  now?: () => number; sleep?: typeof delay;
}

/** One instance per socket. Only stateless inference capacity is shared. */
export class PlatformCall {
  readonly id = crypto.randomUUID();
  readonly done: Promise<void>;
  private resolveDone!: () => void;
  private inspector = new WireInspector();
  private abort = new AbortController();
  private signal: AbortSignal;
  private segmenter: VoiceActivity;
  private inputs: { audio: Buffer; version: number }[] = [];
  private version = 0;
  private greeting = false;
  private processing = false;
  private ended = false;
  private finalizing = false;
  private reported = false;
  private playback?: AbortController;
  private agent?: Receptionist;
  private submitter?: ResolutionSubmitter;
  private events: TraceEvent[] = [];
  private errors: string[] = [];
  private status: PlatformCallReport["status"] = "ended";
  private language: string;
  private now: () => number;
  private sleep: typeof delay;
  private started: number;
  private handshakeTimer: ReturnType<typeof setTimeout>;
  private callTimer?: ReturnType<typeof setTimeout>;
  private drainTimer?: ReturnType<typeof setTimeout>;
  constructor(private options: CallOptions) {
    this.now = options.now ?? Date.now; this.sleep = options.sleep ?? delay;
    this.started = this.now(); this.language = options.language;
    this.signal = AbortSignal.any([this.abort.signal, options.lifetime]);
    this.segmenter = new VoiceActivity(options.vad);
    this.done = new Promise(resolve => this.resolveDone = resolve);
    this.handshakeTimer = setTimeout(() => this.fail(new Error("No start message within 10 seconds")), 10_000);
    this.handshakeTimer.unref();
    this.signal.addEventListener("abort", this.onAbort, { once: true });
    if (this.signal.aborted) this.onAbort();
  }
  private onAbort = () => {
    if (this.status !== "completed") this.status = "error";
    const message = this.signal.reason instanceof Error ? this.signal.reason.message : "Call cancelled";
    if (!this.errors.includes(message)) this.errors.push(message);
    this.inputs = []; this.greeting = false;
    this.end();
  };
  private emit = (event: TraceEvent) => {
    this.events.push(event); if (this.events.length > 500) this.events.shift();
    this.options.onEvent?.({ session_id: this.id, call_id: this.inspector.callId }, event);
  };
  receive(raw: string | Buffer) {
    if (this.ended) return;
    try {
      if (typeof raw !== "string" || raw.length > 8192) throw new Error("Expected a bounded JSON text message");
      const message: unknown = JSON.parse(raw);
      this.inspector.receive(message);
      if (this.inspector.errors.length) throw new Error(this.inspector.errors.at(-1));
      if (!isObject(message)) throw new Error("Expected a JSON object");
      if (message.event === "start") {
        const callId = this.inspector.callId!;
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(callId)) throw new Error("Invalid callSid");
        if (this.options.live && callId.startsWith("workbench-")) throw new Error("Synthetic probe IDs require --dry-run");
        if (!this.options.claim(callId)) throw new Error("callSid already used on another connection");
        clearTimeout(this.handshakeTimer);
        this.started = this.now();
        const start = message.start as Record<string, unknown>;
        const custom = isObject(start.customParameters) ? start.customParameters : {};
        const phone = typeof custom.from_number === "string" && /^\+[1-9]\d{6,14}$/.test(custom.from_number) ? custom.from_number : undefined;
        this.agent = new Receptionist(this.options.inference, this.options.clinic, new Date(this.started).toISOString(), this.language, this.emit, { mode: "platform", callerPhone: phone });
        this.submitter = new ResolutionSubmitter(this.options.clinic, callId, this.options.live, this.options.lifetime, this.now);
        this.emit({ stage: "start", elapsed_ms: 0, detail: this.options.live ? "Real test submissions" : "Dry run" });
        this.callTimer = setTimeout(() => this.end(), 180_000); this.callTimer.unref();
        this.greeting = true; void this.pump();
      } else if (message.event === "media" && !this.finalizing) {
        const media = message.media as Record<string, unknown>;
        if (media.track !== undefined && media.track !== "inbound") throw new Error("Expected inbound audio track");
        const frame = decodeAudio(media.payload)!;
        const result = this.segmenter.push(frame);
        if (result.started) {
          this.version++;
          if (this.playback) {
            this.playback.abort();
            this.send({ event: "clear", streamSid: this.inspector.streamSid });
            this.emit({ stage: "interruption", elapsed_ms: 0, detail: "Stopped paced output on caller speech" });
          }
        }
        if (result.utterance) this.enqueue(result.utterance);
      } else if (message.event === "stop") this.end();
    } catch (error) { this.fail(error); }
  }
  private enqueue(audio: Buffer) {
    if (this.inputs.length >= 3) { this.fail(new Error("Caller audio backlog exceeded three turns")); return; }
    this.inputs.push({ audio, version: this.version }); void this.pump();
  }
  /** A peer stop may contain the final yes: drain it within the submission window. */
  end() {
    if (this.ended) return;
    this.ended = true; clearTimeout(this.handshakeTimer); clearTimeout(this.callTimer);
    this.playback?.abort(); this.submitter?.closed(this.now());
    if (!this.signal.aborted && !this.finalizing) {
      const last = this.segmenter.flush(); if (last) this.inputs.push({ audio: last, version: this.version });
    } else this.segmenter.reset();
    this.options.socket.close(this.errors.length ? 1011 : 1000, this.errors.length ? "Call failed; inspect local report" : "Call ended");
    this.drainTimer = setTimeout(() => this.abort.abort(new Error("Call drain deadline exceeded")), 25_000);
    this.drainTimer.unref();
    if (!this.processing) {
      if (this.inputs.length && !this.signal.aborted) void this.pump();
      else void this.finish();
    }
  }
  private fail(error: unknown) {
    this.errors.push(error instanceof Error ? error.message : String(error));
    this.status = "error";
    this.abort.abort(error); this.end();
  }
  private send(message: unknown) {
    if (this.ended) return;
    if (this.options.socket.send(JSON.stringify(message)) === 0) throw new Error("Socket dropped outbound audio");
  }
  private async speak(text: string) {
    if (this.ended) return;
    const playback = new AbortController(); this.playback = playback;
    const signal = AbortSignal.any([this.signal, playback.signal]);
    try {
      const reply = await this.options.audio.run("speak", { text, language: this.language, wire: true, play: false }, signal);
      const bytes = decodeAudio(reply.payload);
      if (!bytes || bytes.length > 480_000) throw new Error("Invalid synthesized mu-law audio");
      for (let offset = 0; offset < bytes.length; offset += 160) {
        signal.throwIfAborted();
        const frame = Buffer.alloc(160, 255); bytes.copy(frame, 0, offset, offset + 160);
        this.send({ event: "media", streamSid: this.inspector.streamSid, media: { payload: frame.toString("base64") } });
        await this.sleep(20, signal);
      }
      this.send({ event: "mark", streamSid: this.inspector.streamSid, mark: { name: crypto.randomUUID() } });
    } catch (error) { if (!playback.signal.aborted) throw error; }
    finally { if (this.playback === playback) this.playback = undefined; }
  }
  private async pump() {
    if (this.processing || !this.agent || this.reported) return;
    this.processing = true;
    try {
      while (!this.signal.aborted && (this.greeting || this.inputs.length)) {
        let text = "", version = 0;
        if (this.greeting) { this.greeting = false; if (this.ended && !this.inputs.length) break; }
        else {
          const input = this.inputs.shift()!; version = input.version;
          const heard = await this.options.audio.run("transcribe_mulaw", { payload: input.audio.toString("base64") }, this.signal);
          text = heard.text?.trim() ?? "";
          if (!text) continue;
          if (["en", "es", "ca"].includes(heard.language ?? "")) { this.language = heard.language!; this.agent.setLanguage(this.language); }
          this.emit({ stage: "caller", elapsed_ms: heard.elapsed_ms, detail: text });
        }
        let answer = await this.agent.turn(text, this.signal);
        if (version !== this.version || this.segmenter.speaking || this.inputs.length) {
          this.agent.reopenAfterInterruption();
          this.emit({ stage: "interruption", elapsed_ms: 0, detail: "New caller speech superseded a pending answer; nothing submitted" });
          continue;
        }
        if (this.agent.record) {
          this.finalizing = true;
          const receipts = await this.submitter!.submit(this.agent.record);
          if (receipts.every(receipt => receipt.accepted || receipt.dry_run)) this.status = "completed";
          else {
            this.status = "error"; this.errors.push("One or more actions were not accepted; inspect submission receipts");
            answer = ({ en: "I couldn't record the outcome of this call. Thank you for calling.", es: "No he podido registrar el resultado de la llamada. Gracias por llamar.", ca: "No he pogut registrar el resultat de la trucada. Gràcies per trucar." } as Record<string, string>)[this.language]!;
            const closing = this.agent.transcript.at(-1); if (closing?.role === "agent") closing.text = answer;
          }
        }
        this.emit({ stage: "agent", elapsed_ms: 0, detail: answer });
        await this.speak(answer);
        if (this.finalizing) {
          if (!this.ended) await this.sleep(200, this.signal); // tail playback after paced frames
          this.end(); break;
        }
      }
    } catch (error) { if (!this.signal.aborted) this.fail(error); }
    finally {
      this.processing = false;
      if (this.ended) await this.finish();
    }
  }
  private async finish() {
    if (this.reported) return;
    this.reported = true; clearTimeout(this.handshakeTimer); clearTimeout(this.callTimer); clearTimeout(this.drainTimer);
    this.signal.removeEventListener("abort", this.onAbort); this.submitter?.dispose();
    this.inputs = []; this.segmenter.reset();
    try {
      await this.options.report({ session_id: this.id, call_id: this.inspector.callId, stream_sid: this.inspector.streamSid,
        mode: this.options.live ? "platform" : "dry_run", reference_time: new Date(this.started).toISOString(), elapsed_ms: this.now() - this.started,
        status: this.status, ...(this.agent?.record ? { record: this.agent.record } : {}), submissions: this.submitter?.receipts ?? [],
        transcript: this.agent?.transcript ?? [], events: this.events, errors: this.errors });
    } catch { console.error(`Call report ${this.id} could not be saved`); }
    finally { this.resolveDone(); }
  }
}
