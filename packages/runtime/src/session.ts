import { randomUUID } from "node:crypto";
import { Session } from "../../domain/src/session.js";
import { ToolGateway, toolDefinitions } from "../../application/src/tools.js";
import {
  TELEPHONE_AUDIO,
  sameFormat,
  type AudioFrame,
  type ClinicDataSource,
  type ConversationEngine,
  type DomainEvent,
  type Repository,
} from "../../contracts/src/index.js";
import { DeliveryService } from "./delivery.js";
export class CallRuntime {
  readonly session: Session;
  readonly gateway: ToolGateway;
  private sequence = 0;
  private writes = Promise.resolve();
  private writeFailure?: unknown;
  private closing?: Promise<void>;
  constructor(
    readonly engine: ConversationEngine,
    clinic: ClinicDataSource,
    private repository: Repository,
    private deliveries: DeliveryService,
    readonly callId: string,
    startedAt: Date,
    private publish: (event: DomainEvent) => void,
    private output: (audio: AudioFrame) => Promise<void> = async () => {},
    private stopAudio: () => void = () => {},
  ) {
    this.session = new Session(callId, startedAt, (type, data) =>
      this.emit(type, data),
    );
    this.gateway = new ToolGateway(this.session, clinic);
  }
  emit(type: string, data: unknown = {}) {
    const event: DomainEvent = {
      id: randomUUID(),
      callId: this.callId,
      sequence: ++this.sequence,
      at: new Date().toISOString(),
      type,
      data,
    };
    this.publish(event);
    this.writes = this.writes
      .then(() => this.repository.append(event))
      .catch((error) => {
        this.writeFailure = error;
      });
  }
  async start(audio = false) {
    if (
      audio &&
      (!this.engine.capabilities.input.some((f) =>
        sameFormat(f, TELEPHONE_AUDIO),
      ) ||
        !this.engine.capabilities.output.some((f) =>
          sameFormat(f, TELEPHONE_AUDIO),
        ))
    )
      throw new Error("Engine incompatible with telephone transport");
    this.emit("call.started", {
      engine: this.engine.id,
      mode: audio ? "audio" : "text",
      startedAt: this.session.startedAt.toISOString(),
    });
    await this.engine.start(
      {
        userText: (t) => this.session.hear(t),
        assistantText: (t) => {
          this.session.presented(t);
          this.emit("assistant.text", { text: t });
        },
        audio: this.output,
        interrupt: () => {
          this.stopAudio();
          this.emit("audio.interrupted");
        },
        tool: (name, args, signal) => this.gateway.execute(name, args, signal),
        context: () => JSON.stringify(this.session.modelSnapshot()),
        event: (type, data) => this.emit(type, data),
      },
      toolDefinitions,
    );
  }
  async text(text: string) {
    this.session.assertOpen();
    await this.engine.acceptText(text);
  }
  async audio(frame: AudioFrame) {
    this.session.assertOpen();
    await this.engine.acceptAudio(frame);
  }
  close() {
    if (this.closing) return this.closing;
    this.closing = this.finish();
    return this.closing;
  }
  private async finish() {
    const closedAt = Date.now();
    this.session.closed = true;
    this.stopAudio();
    try {
      await this.engine.close();
    } catch {
      this.emit("engine.error", { code: "close_failed" });
    }
    const actions = this.session.finalActions();
    this.emit("call.closed", { actions: actions.length });
    await this.writes;
    if (this.writeFailure)
      throw new Error("Persistence failed; delivery not attempted");
    if (!actions.length) {
      this.emit("call.incomplete", { reason: "no_confirmed_action" });
      await this.writes;
      return;
    }
    for (const item of actions) {
      const delivery = await this.deliveries.prepare(
        this.callId,
        item.taskId,
        item.action,
        closedAt,
      );
      const result = await this.deliveries.send(delivery);
      this.emit("delivery.result", {
        taskId: item.taskId,
        status: result.status,
        attempts: result.attempts,
      });
    }
    await this.writes;
  }
  async flush() {
    await this.writes;
    if (this.writeFailure) throw this.writeFailure;
  }
}
