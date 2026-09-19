import { DurableObject } from "cloudflare:workers";
import { OperationsService } from "../operations/service.ts";
import { WorkerSocket, connectWorkerSocket } from "./socket.ts";
import { readRuntimeConfig, storeCallEvent } from "./storage.ts";
import { operationsOrigin } from "../operations/twilio.ts";

export class OperationsDemo extends DurableObject<Env> {
  private service: OperationsService;
  private sequence = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.service = new OperationsService({
      origin: operationsOrigin,
      checkpoint: async value => {
        await this.ctx.storage.put("run", value);
        if (value.active) await this.ctx.storage.setAlarm(Date.now() + 310000);
        else await this.ctx.storage.deleteAlarm();
      },
      options: {
        connect: connectWorkerSocket,
        loadConfig: org => readRuntimeConfig(env.prosper_desk, org ?? "arenal"),
        waitUntil: promise => this.ctx.waitUntil(promise),
        emitEvent: async (type, callId, configVersion, payload = {}) => {
          const event = { eventId: crypto.randomUUID(), schemaVersion: 1 as const, type, callId,
            configVersion, occurredAt: new Date().toISOString(), payload: { ...payload, sequence: ++this.sequence } };
          await storeCallEvent(env.prosper_desk, event);
          return event;
        },
      },
    });
    ctx.blockConcurrencyWhile(async () => {
      const previous = await ctx.storage.get<{ id: string; sid?: string; active: boolean }>("run");
      if (previous?.active) this.service.recover(previous.id, previous.sid);
    });
  }
  async alarm() { await this.service.stop(); }
  async fetch(request: Request) {
    if (new URL(request.url).pathname.endsWith("/ws")) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || !this.service.phoneAllowed(new URL(request.url))) return new Response("Forbidden", { status: 403 });
      const pair = new WebSocketPair();
      const socket = new WorkerSocket(pair[1]);
      await this.service.attachPhone(socket);
      pair[1].accept();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return this.service.fetch(request);
  }
}
