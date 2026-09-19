import type WebSocket from "ws";
import {
  TELEPHONE_AUDIO,
  sameFormat,
  type AudioFrame,
  type ConversationEngine,
  type EngineHost,
  type ToolDefinition,
  type Capabilities,
} from "../../contracts/src/index.js";
import { instructions } from "../../conversation/src/engines.js";
import { opened, socketFactory, type SocketFactory } from "./socket.js";

/** Native speech-to-speech adapter. No artificial STT/TTS decomposition. */
export class RealtimeEngine implements ConversationEngine {
  readonly id = "realtime";
  readonly capabilities: Capabilities = {
    input: [TELEPHONE_AUDIO],
    output: [TELEPHONE_AUDIO],
    textInput: true,
    transcripts: true,
    tools: true,
    interrupt: true,
    turnDetection: "provider",
    languages: ["es", "en", "ca"],
  };
  private socket?: WebSocket;
  private host!: EngineHost;
  private stopped = false;
  private epoch = 0;
  private pendingEpochs: number[] = [];
  private responseEpochs = new Map<string, number>();
  private completed = new Set<string>();
  private queuedBytes = 0;
  private steps = 0;
  private active = false;
  private generation = new AbortController();
  private audioWork = Promise.resolve();
  private item?: string;
  private playedBytes = 0;
  private ready?: () => void;
  private failReady?: (error: Error) => void;
  constructor(
    private key: string,
    private model: string,
    private connect: SocketFactory = socketFactory,
  ) {}
  private send(event: object) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(event));
  }
  async start(host: EngineHost, tools: ToolDefinition[]) {
    this.host = host;
    const socket = (this.socket = this.connect(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.model)}`,
      { Authorization: `Bearer ${this.key}` },
    ));
    const configured = new Promise<void>((resolve, reject) => {
      this.ready = resolve;
      this.failReady = reject;
    });
    // Attach rejection handler before the asynchronous handshake completes.
    void configured.catch(() => {});
    const timeout = setTimeout(
      () => this.failReady?.(new Error("Realtime setup timed out")),
      12000,
    );
    socket.on("error", () => this.failure());
    socket.on("close", () => {
      if (!this.stopped) this.failure();
    });
    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        void this.handle(event).catch(() => this.failure());
      } catch {
        this.failure();
      }
    });
    try {
      await opened(socket);
      this.send({
        type: "session.update",
        session: {
          type: "realtime",
          model: this.model,
          output_modalities: ["audio"],
          instructions: instructions + "\n" + host.context(),
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: false,
              },
            },
            output: { format: { type: "audio/pcmu" }, voice: "marin" },
          },
          tools: tools.map((t) => ({ type: "function", ...t })),
          tool_choice: "auto",
        },
      });
      await configured;
      this.respond();
    } catch (error) {
      socket.close();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  private failure() {
    this.failReady?.(new Error("Realtime provider failed"));
    this.host.event("engine.error", { code: "realtime_failed" });
  }
  private respond() {
    if (this.stopped) return;
    if (++this.steps > 12) {
      this.failure();
      return;
    }
    this.pendingEpochs.push(this.epoch);
    this.active = true;
    this.send({
      type: "response.create",
      response: { instructions: instructions + "\n" + this.host.context() },
    });
  }
  // Wire events remain private to this adapter.
  private async handle(e: any) {
    if (this.stopped) return;
    if (e.type === "session.updated") {
      this.ready?.();
      return;
    }
    if (e.type === "error") {
      this.failure();
      return;
    }
    if (e.type === "response.created") {
      const epoch = this.pendingEpochs.shift();
      if (epoch !== undefined) this.responseEpochs.set(e.response.id, epoch);
      return;
    }
    if (e.type.startsWith("response.") && e.type !== "response.created") {
      const id = e.response_id ?? e.response?.id;
      if (this.responseEpochs.get(id) !== this.epoch) return;
    }
    if (e.type === "input_audio_buffer.speech_started") {
      await this.interrupt();
      return;
    }
    if (e.type === "conversation.item.input_audio_transcription.completed") {
      if (typeof e.transcript === "string" && e.transcript.trim()) {
        this.steps = 0;
        this.host.userText(e.transcript);
        this.respond();
      }
      return;
    }
    if (e.type === "response.output_audio.delta") {
      const epoch = this.epoch;
      const frame = {
        data: Buffer.from(e.delta, "base64"),
        format: TELEPHONE_AUDIO,
      };
      if (this.queuedBytes + frame.data.length > 240000) {
        this.failure();
        await this.interrupt();
        return;
      }
      this.queuedBytes += frame.data.length;
      if (this.item !== e.item_id) {
        this.item = e.item_id;
        this.playedBytes = 0;
      }
      this.audioWork = this.audioWork
        .then(async () => {
          if (epoch !== this.epoch) return;
          await this.host.audio(frame);
          if (epoch === this.epoch) this.playedBytes += frame.data.length;
        })
        .catch(() => this.failure())
        .finally(() => {
          this.queuedBytes -= frame.data.length;
        });
      return;
    }
    if (e.type === "response.output_audio_transcript.done") {
      const epoch = this.epoch;
      await this.audioWork;
      if (epoch === this.epoch) this.host.assistantText(e.transcript);
      return;
    }
    if (e.type === "response.done") {
      if (this.completed.has(e.response.id)) return;
      this.completed.add(e.response.id);
      this.active = false;
      if (e.response?.status !== "completed") return;
      const epoch = this.epoch;
      const signal = this.generation.signal;
      const calls = (e.response.output ?? []).filter(
        (item: any) => item.type === "function_call",
      );
      for (const call of calls) {
        if (epoch !== this.epoch) return;
        let args: unknown;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          args = null;
        }
        const result = await this.host.tool(call.name, args, signal);
        if (epoch !== this.epoch) return;
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          },
        });
      }
      if (calls.length && epoch === this.epoch) this.respond();
    }
  }
  async acceptAudio(frame: AudioFrame) {
    if (!sameFormat(frame.format, TELEPHONE_AUDIO))
      throw new Error("Unsupported audio");
    this.send({
      type: "input_audio_buffer.append",
      audio: Buffer.from(frame.data).toString("base64"),
    });
  }
  async acceptText(text: string) {
    void this.interrupt();
    this.steps = 0;
    this.host.userText(text);
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.respond();
  }
  async interrupt() {
    this.epoch++;
    this.generation.abort();
    this.generation = new AbortController();
    this.host?.interrupt();
    if (this.active) this.send({ type: "response.cancel" });
    this.active = false;
    if (this.item) {
      this.send({
        type: "conversation.item.truncate",
        item_id: this.item,
        content_index: 0,
        audio_end_ms: Math.floor(this.playedBytes / 8),
      });
      this.item = undefined;
    }
  }
  async close() {
    this.stopped = true;
    await this.interrupt();
    this.socket?.close();
    await this.audioWork;
  }
}
