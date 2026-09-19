import { type SpeechDetector } from "./silero";
import { type Outcome } from "../data";
import { decodeAudio, WireInspector } from "../protocol";
import { isObject } from "../validation";
import { Receptionist, type ClinicReader, type TraceEvent } from "../voice/agent";
import { type Inference } from "../voice/runtime";
import { abortable, delay, frameEnergy, SharedAudio, VoiceActivity, type VadOptions } from "./audio";
import { callPhrases } from "../voice/phrases";
import { ResolutionSubmitter, type SubmissionReceipt } from "./submission";

export interface CallSocket { send(message: string): number; close(code: number, reason: string): void }
export interface CallIdentity { session_id: string; call_id?: string }
export type EndReason = "peer_stop" | "socket_closed" | "call_timeout" | "completed" | "error" | "shutdown";
export interface PlatformCallReport {
  session_id: string; call_id?: string; stream_sid?: string; mode: "platform" | "dry_run";
  reference_time: string; elapsed_ms: number; status: "completed" | "ended" | "error";
  record?: Outcome; submissions: SubmissionReceipt[]; transcript: Receptionist["transcript"];
  events: TraceEvent[]; errors: string[]; end_reason?: EndReason; close_code?: number; audio_stats?: Record<string, number>;
}
export interface CallOptions {
  inference: Inference; audio: SharedAudio; clinic: ClinicReader; socket: CallSocket;
  lifetime: AbortSignal; live: boolean; language: string; vad: VadOptions;
  createSpeechDetector?(): SpeechDetector | undefined;
  claim(callId: string): boolean;
  report(report: PlatformCallReport): Promise<void>;
  onEvent?(call: CallIdentity, event: TraceEvent): void;
  now?: () => number; sleep?: typeof delay;
  turnTimeoutMs?: number; waitNoticeMs?: number; idleNoticeMs?: number; callTimeoutMs?: number;
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
  private detector?: SpeechDetector;
  private detection: Promise<void> = Promise.resolve();
  private pendingFrames = 0;
  private closing = false;
  private inputs: { audio: Buffer; version: number }[] = [];
  private version = 0;
  private greeting = false;
  private processing = false;
  private ended = false;
  private finalizing = false;
  private reported = false;
  private playback?: AbortController;
  private thinking?: AbortController;
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
  private idleTimer?: ReturnType<typeof setTimeout>;
  private idleNotice = false;
  private idleNotified = false;
  private endReason?: EndReason;
  private closeCode?: number;
  private marks = new Map<string, number>();
  private stats = { inbound_frames: 0, above_threshold_frames: 0, max_rms: 0, speech_starts: 0,
    utterances: 0, empty_transcriptions: 0, outbound_frames: 0, output_turns: 0, playback_acks: 0 };
  constructor(private options: CallOptions) {
    this.now = options.now ?? Date.now; this.sleep = options.sleep ?? delay;
    this.started = this.now(); this.language = options.language;
    this.signal = AbortSignal.any([this.abort.signal, options.lifetime]);
    this.segmenter = new VoiceActivity(options.vad);
    this.detector = options.createSpeechDetector?.();
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
    this.end(this.options.lifetime.aborted ? "shutdown" : "error");
  };
  private emit = (event: TraceEvent) => {
    event = { ...event, at_ms: Math.max(0, this.now() - this.started) };
    this.events.push(event); if (this.events.length > 500) this.events.shift();
    this.options.onEvent?.({ session_id: this.id, call_id: this.inspector.callId }, event);
  };
  receive(raw: string | Buffer) {
    if (this.ended || this.closing) return;
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
        this.callTimer = setTimeout(() => this.end("call_timeout"), this.options.callTimeoutMs ?? 180_000); this.callTimer.unref();
        this.greeting = true; void this.pump();
      } else if (message.event === "media" && !this.finalizing) {
        const media = message.media as Record<string, unknown>;
        if (media.track !== undefined && media.track !== "inbound") throw new Error("Expected inbound audio track");
        const frame = decodeAudio(media.payload)!;
        this.stats.inbound_frames++;
        const rms = frameEnergy(frame); this.stats.max_rms = Math.max(this.stats.max_rms, rms);
        if (rms >= this.options.vad.threshold) this.stats.above_threshold_frames++;
        if (this.stats.inbound_frames === 1) this.emit({ stage: "audio_in", elapsed_ms: 0, detail: "First inbound audio frame received" });
        if (!this.detector) this.acceptFrame(frame, rms);
        else {
          if (++this.pendingFrames > 100) throw new Error("Speech detection fell more than two seconds behind");
          this.detection = this.detection.then(async () => {
            if (this.signal.aborted || this.finalizing || this.reported) return;
            const speech = await this.detector!.push(frame);
            if (!this.signal.aborted && !this.finalizing && !this.reported) this.acceptFrame(frame, rms, speech);
          }).catch(error => this.fail(error)).finally(() => { this.pendingFrames--; });
        }
      } else if (message.event === "mark") {
        const mark = isObject(message.mark) ? message.mark.name : undefined;
        if (typeof mark === "string" && this.marks.has(mark)) {
          const sentAt = this.marks.get(mark)!; this.marks.delete(mark); this.stats.playback_acks++;
          this.emit({ stage: "playback_ack", elapsed_ms: this.now() - sentAt, detail: "Peer acknowledged the output mark" });
        }
      } else if (message.event === "stop") this.end("peer_stop");
    } catch (error) { this.fail(error); }
  }
  private acceptFrame(frame: Buffer, rms: number, speech?: boolean) {
    const result = this.segmenter.push(frame, speech);
        if (result.started) {
          this.version++; this.stats.speech_starts++;
          this.thinking?.abort(new Error("Superseded by caller speech"));
          clearTimeout(this.idleTimer); this.idleNotice = false;
          this.emit({ stage: "speech_start", elapsed_ms: 0, detail: "Caller speech detected", metrics: { rms, threshold: this.options.vad.threshold } });
          if (this.playback) {
            this.playback.abort();
            this.send({ event: "clear", streamSid: this.inspector.streamSid });
            this.emit({ stage: "interruption", elapsed_ms: 0, detail: "Stopped paced output on caller speech" });
          }
        }
        if (result.utterance) this.enqueue(result.utterance);
  }
  private enqueue(audio: Buffer) {
    if (this.inputs.length >= 3) { this.fail(new Error("Caller audio backlog exceeded three turns")); return; }
    this.stats.utterances++;
    this.emit({ stage: "utterance", elapsed_ms: 0, detail: "Caller audio queued for transcription", metrics: { duration_ms: audio.length / 8, pending_turns: this.inputs.length } });
    this.inputs.push({ audio, version: this.version }); void this.pump();
  }
  /** A peer stop may contain the final yes: drain it within the submission window. */
  end(reason: EndReason = "socket_closed", closeCode?: number) {
    if (closeCode !== undefined) this.closeCode = closeCode;
    if (this.ended) return;
    // Drain already received VAD frames before flushing the final spoken confirmation.
    if (this.pendingFrames && !this.signal.aborted && !this.finalizing) {
      if (this.closing) return;
      this.closing = true; this.playback?.abort(); this.submitter?.closed(this.now());
      clearTimeout(this.callTimer); clearTimeout(this.idleTimer);
      this.options.socket.close(1000, "Call ended");
      this.drainTimer = setTimeout(() => this.abort.abort(new Error("Call drain deadline exceeded")), 25000);
      this.drainTimer.unref();
      void this.detection.then(() => { this.closing = false; clearTimeout(this.drainTimer); this.end(reason, closeCode); });
      return;
    }
    this.endReason = reason;
    this.emit({ stage: "end", elapsed_ms: 0, detail: reason });
    clearTimeout(this.idleTimer); this.idleNotice = false;
    this.ended = true; clearTimeout(this.handshakeTimer); clearTimeout(this.callTimer);
    this.playback?.abort(); this.submitter?.closed(this.now());
    if (!this.signal.aborted && !this.finalizing) {
      const last = this.segmenter.flush(); if (last) { this.stats.utterances++; this.inputs.push({ audio: last, version: this.version }); }
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
    this.abort.abort(error); this.end("error");
  }
  private send(message: unknown) {
    if (this.ended || this.closing) return;
    if (this.options.socket.send(JSON.stringify(message)) === 0) throw new Error("Socket dropped outbound audio");
  }
  private async speak(text: string, kind: "agent" | "service" = "agent", deadline?: AbortSignal) {
    if (this.ended || this.closing) return false;
    const playback = new AbortController(); this.playback = playback;
    const signal = AbortSignal.any([this.signal, playback.signal, ...(deadline ? [deadline] : [])]);
    const started = this.now();
    if (this.agent) this.language = this.agent.currentLanguage;
    try {
      this.emit({ stage: "tts_start", elapsed_ms: 0, detail: "Speech synthesis queued" });
      const fixedPhrase = Object.values(callPhrases).some(phrases => Object.values(phrases).includes(text));
      const reply = await this.options.audio.run("speak", { text, language: this.language, wire: true, play: false, cache: fixedPhrase }, AbortSignal.any([signal, AbortSignal.timeout(12000)]));
      this.emit({ stage: "tts", elapsed_ms: reply.elapsed_ms, detail: "Speech synthesis ready", metrics: {
        queue_ms: reply.queue_ms ?? 0, total_ms: reply.total_ms ?? reply.elapsed_ms, duration_ms: reply.duration_ms ?? 0, cache_hit: reply.cache_hit ? 1 : 0 } });
      const bytes = decodeAudio(reply.payload);
      if (!bytes || bytes.length > 480_000) throw new Error("Invalid synthesized mu-law audio");
      for (let offset = 0; offset < bytes.length; offset += 160) {
        signal.throwIfAborted();
        const frame = Buffer.alloc(160, 255); bytes.copy(frame, 0, offset, offset + 160);
        this.send({ event: "media", streamSid: this.inspector.streamSid, media: { payload: frame.toString("base64") } });
        this.stats.outbound_frames++;
        if (offset === 0) {
          this.stats.output_turns++;
          this.emit({ stage: kind, elapsed_ms: this.now() - started, detail: text });
          this.emit({ stage: "audio_out", elapsed_ms: this.now() - started, detail: "First output audio frame sent" });
        }
        await this.sleep(20, signal);
      }
      const mark = crypto.randomUUID(); this.marks.set(mark, this.now());
      if (this.marks.size > 100) this.marks.delete(this.marks.keys().next().value!);
      this.send({ event: "mark", streamSid: this.inspector.streamSid, mark: { name: mark } });
      this.emit({ stage: "output_sent", elapsed_ms: this.now() - started, detail: "All output frames sent; peer playback acknowledgement pending", metrics: { duration_ms: bytes.length / 8 } });
      return true;
    } catch (error) {
      this.emit({ stage: "output_incomplete", elapsed_ms: this.now() - started, detail: playback.signal.aborted ? "Output interrupted or socket closed" : "Output failed" });
      if (!playback.signal.aborted) throw error; return false;
    }
    finally { if (this.playback === playback) this.playback = undefined; }
  }
  private scheduleIdleNotice() {
    clearTimeout(this.idleTimer);
    if (this.ended || this.finalizing || this.idleNotified) return;
    this.idleTimer = setTimeout(() => {
      if (this.ended || this.processing || this.segmenter.speaking || this.inputs.length) return;
      this.idleNotified = true; this.idleNotice = true; void this.pump();
    }, this.options.idleNoticeMs ?? 12000);
    this.idleTimer.unref();
  }
  private async respond(text: string, version: number) {
    const deadline = new AbortController(); this.thinking = deadline;
    const timeout = setTimeout(() => deadline.abort(new Error("Voice turn timed out")), this.options.turnTimeoutMs ?? 25000);
    const signal = AbortSignal.any([this.signal, deadline.signal]);
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    const started = this.now();
    try {
      const turn = abortable(this.agent!.turn(text, signal), signal);
      const notice = new Promise<undefined>(resolve => { noticeTimer = setTimeout(() => resolve(undefined), this.options.waitNoticeMs ?? 4000); });
      const first = await Promise.race([turn, notice]);
      if (first !== undefined) return first;
      if (!this.ended && version === this.version && !this.segmenter.speaking && !this.inputs.length) {
        this.emit({ stage: "slow_turn", elapsed_ms: this.now() - started, detail: "Model/tool work is still pending; playing one wait notice" });
        await this.speak(callPhrases[this.agent!.currentLanguage].waiting, "service", signal);
      }
      return await turn;
    } finally {
      clearTimeout(timeout); clearTimeout(noticeTimer);
      if (this.thinking === deadline) this.thinking = undefined;
      this.emit({ stage: "turn", elapsed_ms: this.now() - started, detail: signal.aborted ? "Turn cancelled or timed out" : "Turn processing finished" });
    }
  }
  private async pump() {
    if (this.processing || !this.agent || this.reported) return;
    this.processing = true;
    try {
      while (!this.signal.aborted && (this.greeting || this.inputs.length || this.idleNotice)) {
        if (this.idleNotice && !this.inputs.length) {
          this.idleNotice = false;
          this.emit({ stage: "idle", elapsed_ms: 0, detail: "No recognized caller response; playing one repeat prompt", metrics: { ...this.stats } });
          await this.speak(callPhrases[this.agent.currentLanguage].idle, "service"); continue;
        }
        let text = "", version = 0;
        const greeting = this.greeting;
        if (greeting) { this.greeting = false; if (this.ended && !this.inputs.length) break; }
        else {
          const input = this.inputs.shift()!; version = input.version;
          this.emit({ stage: "asr_start", elapsed_ms: 0, detail: "Transcription queued" });
          const heard = await this.options.audio.run("transcribe_mulaw", { payload: input.audio.toString("base64") }, AbortSignal.any([this.signal, AbortSignal.timeout(12000)]));
          text = heard.text?.trim() ?? "";
          this.emit({ stage: "asr", elapsed_ms: heard.elapsed_ms, detail: text ? "Caller speech recognized" : "Empty transcription", metrics: { queue_ms: heard.queue_ms ?? 0, total_ms: heard.total_ms ?? heard.elapsed_ms, duration_ms: input.audio.length / 8 } });
          if (!text) {
            this.stats.empty_transcriptions++;
            if (version === this.version && !this.inputs.length && !this.segmenter.speaking) await this.speak(callPhrases[this.agent.currentLanguage].repeat, "service");
            this.scheduleIdleNotice(); continue;
          }
          this.idleNotified = false; this.idleNotice = false;
          if (["en", "es", "ca"].includes(heard.language ?? "")) { this.language = heard.language!; this.agent.setLanguage(this.language); }
          this.emit({ stage: "caller", elapsed_ms: heard.elapsed_ms, detail: text });
        }
        let answer: string;
        try { answer = greeting ? this.agent.greet() : await this.respond(text, version); }
        catch (error) {
          if (!this.signal.aborted && version !== this.version) {
            this.agent.reopenAfterInterruption(true);
            this.emit({ stage: "interruption", elapsed_ms: 0, detail: "Cancelled stale model work for new caller speech" });
            continue;
          }
          throw error;
        }
        await this.detection;
        this.language = this.agent.currentLanguage;
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
        const delivered = await this.speak(answer);
        if (delivered) { this.agent.markDelivered(); this.scheduleIdleNotice(); }
        else if (!this.finalizing) this.agent.reopenAfterInterruption();
        if (this.finalizing) {
          if (!this.ended) await this.sleep(200, this.signal); // tail playback after paced frames
          this.end(this.status === "completed" ? "completed" : "error"); break;
        }
      }
    } catch (error) {
      if (!this.signal.aborted) {
        if (!this.ended && !this.finalizing && error instanceof Error && /timed out/.test(error.message)) {
          this.emit({ stage: "timeout", elapsed_ms: 0, detail: error.message });
          await this.speak(callPhrases[this.agent.currentLanguage].failure, "service", AbortSignal.timeout(5000)).catch(() => {});
        }
        this.fail(error);
      }
    }
    finally {
      this.processing = false;
      if (this.ended) await this.finish();
    }
  }
  private async finish() {
    if (this.reported) return;
    this.reported = true;
    await this.detection;
    clearTimeout(this.handshakeTimer); clearTimeout(this.callTimer); clearTimeout(this.drainTimer); clearTimeout(this.idleTimer);
    this.signal.removeEventListener("abort", this.onAbort); this.submitter?.dispose();
    this.inputs = []; this.segmenter.reset(); this.detector?.reset(); this.marks.clear();
    this.emit({ stage: "audio_summary", elapsed_ms: 0, detail: "Final audio counters", metrics: { ...this.stats } });
    try {
      await this.options.report({ session_id: this.id, call_id: this.inspector.callId, stream_sid: this.inspector.streamSid,
        mode: this.options.live ? "platform" : "dry_run", reference_time: new Date(this.started).toISOString(), elapsed_ms: this.now() - this.started,
        status: this.status, ...(this.agent?.record ? { record: this.agent.record } : {}), submissions: this.submitter?.receipts ?? [],
        transcript: this.agent?.transcript ?? [], events: this.events, errors: this.errors,
        end_reason: this.endReason, ...(this.closeCode !== undefined ? { close_code: this.closeCode } : {}), audio_stats: { ...this.stats } });
    } catch { console.error(`Call report ${this.id} could not be saved`); }
    finally { this.resolveDone(); }
  }
}
