import { DurableObject } from "cloudflare:workers";
import { handleCall } from "../agent/session.ts";
import { handoffTwiml } from "../agent/twilio-transfer.ts";
import { WorkerSocket, connectWorkerSocket } from "./socket.ts";
import { readRuntimeConfig, storeCallEvent } from "./storage.ts";

const MAX_CALL_MS = 30 * 60 * 1_000;

export class VoiceCall extends DurableObject<Env> {
  private connected = false;
  private sequence = 0;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    if (this.connected) return new Response("Call already connected", { status: 409 });
    this.connected = true;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const sessionId = this.ctx.id.toString();
    await this.env.DB.batch([
      this.env.DB.prepare("DELETE FROM voice_sessions WHERE expires_at <= ?").bind(Date.now()),
      this.env.DB.prepare("INSERT INTO voice_sessions (id, expires_at) VALUES (?, ?)")
        .bind(sessionId, Date.now() + MAX_CALL_MS),
    ]);
    const socket = new WorkerSocket(server);
    // Audio streaming and an outbound ElevenLabs socket require a live, non-hibernating DO.
    const timer = setTimeout(() => socket.close(1000, "Maximum call duration reached"), MAX_CALL_MS);
    socket.once("close", () => {
      clearTimeout(timer);
      this.ctx.waitUntil(this.env.DB.prepare("DELETE FROM voice_sessions WHERE id = ?").bind(sessionId).run());
    });
    await handleCall(socket, {
      connect: connectWorkerSocket,
      loadConfig: (orgSlug = "arenal") => readRuntimeConfig(this.env.DB, orgSlug),
      emitEvent: async (type, callId, configVersion, payload = {}) => {
        const event = {
          eventId: crypto.randomUUID(), schemaVersion: 1 as const, type,
          occurredAt: new Date().toISOString(), callId, configVersion,
          payload: { ...payload, sequence: ++this.sequence },
        };
        await storeCallEvent(this.env.DB, event);
        return event;
      },
      waitUntil: (promise) => this.ctx.waitUntil(promise),
    });
    server.accept();
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      if (["PLATFORM_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"].some((name) => !process.env[name]?.trim())) {
        return new Response("Voice provider credentials are not configured", { status: 503 });
      }
      return env.CALLS.get(env.CALLS.newUniqueId()).fetch(request);
    }
    if (url.pathname === "/health") {
      const result = await env.DB.prepare("SELECT count(*) AS count FROM voice_sessions WHERE expires_at > ?")
        .bind(Date.now()).first<{ count: number }>();
      return Response.json({ ok: true, activeCalls: result?.count ?? 0, checkedAt: new Date().toISOString() });
    }
    if (url.pathname === "/twiml/handoff") {
      return new Response(handoffTwiml(url.searchParams.get("summary") ?? undefined), {
        headers: { "content-type": "text/xml; charset=utf-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
