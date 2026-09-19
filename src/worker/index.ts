import { DurableObject } from "cloudflare:workers";
import { handleCall } from "../agent/session.ts";
import { handoffTwiml, liveStreamTwiml } from "../agent/twilio-transfer.ts";
import { WorkerSocket, connectWorkerSocket } from "./socket.ts";
import { readRuntimeConfig, storeCallEvent } from "./storage.ts";
import { LiveBridge } from "../agent/live-bridge.ts";

const MAX_CALL_MS = 30 * 60 * 1_000;

export class VoiceCall extends DurableObject<Env> {
  private connected = false;
  private sequence = 0;
  private bridge = new LiveBridge();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = this.ctx.id.toString();
    if (url.pathname.startsWith("/twiml/live/")) {
      const join = url.searchParams.get("join") ?? "";
      const host = this.bridge.getLiveSession(join);
      if (!host) return new Response("Live call not found", { status: 404 });
      const wsUrl = `${url.origin.replace(/^http/, "ws")}/ws/${sessionId}`;
      const callback = new URL(`/twiml/stream-status/${sessionId}`, url.origin);
      callback.searchParams.set("join", join);
      host.freezeDisplay();
      return new Response(liveStreamTwiml(wsUrl, join, url.searchParams.get("org") ?? "arenal", callback.toString(), true), {
        headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (url.pathname.startsWith("/twiml/stream-status/")) {
      const join = url.searchParams.get("join") ?? "";
      const host = this.bridge.getLiveSession(join);
      if (!host) return new Response(null, { status: 204 });
      const body = new URLSearchParams(await request.text());
      await host.audit?.("handoff.stream.status", {
        provider: "twilio", event: body.get("StreamEvent"), streamSid: body.get("StreamSid"),
      });
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const joining = url.pathname !== "/ws";
    if (joining && (!this.connected || !this.bridge.liveSessionIds().length)) {
      return new Response("Live call not found", { status: 404 });
    }
    if (!joining && this.connected) return new Response("Call already connected", { status: 409 });
    if (!joining) this.connected = true;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (!joining) await this.env.prosper_desk.batch([
      this.env.prosper_desk.prepare("DELETE FROM voice_sessions WHERE expires_at <= ?").bind(Date.now()),
      this.env.prosper_desk.prepare("INSERT INTO voice_sessions (id, expires_at) VALUES (?, ?)")
        .bind(sessionId, Date.now() + MAX_CALL_MS),
    ]);
    const socket = new WorkerSocket(server);
    // Audio streaming and an outbound ElevenLabs socket require a live, non-hibernating DO.
    const timer = setTimeout(() => socket.close(1000, "Maximum call duration reached"), MAX_CALL_MS);
    socket.once("close", () => {
      clearTimeout(timer);
      if (!joining && !this.bridge.liveSessionIds().length) {
        this.ctx.waitUntil(this.env.prosper_desk.prepare("DELETE FROM voice_sessions WHERE id = ?").bind(sessionId).run());
      }
    });
    await handleCall(socket, {
      connect: connectWorkerSocket,
      liveBridge: this.bridge,
      joinOnly: joining,
      handoffUrl: `${url.origin}/twiml/live/${sessionId}`,
      onEnd: () => {
        this.ctx.waitUntil(this.env.prosper_desk.prepare("DELETE FROM voice_sessions WHERE id = ?").bind(sessionId).run());
      },
      loadConfig: (orgSlug = "arenal") => readRuntimeConfig(this.env.prosper_desk, orgSlug),
      emitEvent: async (type, callId, configVersion, payload = {}) => {
        const event = {
          eventId: crypto.randomUUID(), schemaVersion: 1 as const, type,
          occurredAt: new Date().toISOString(), callId, configVersion,
          payload: { ...payload, sequence: ++this.sequence },
        };
        await storeCallEvent(this.env.prosper_desk, event);
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
    const routed = url.pathname.match(/^\/(?:ws|twiml\/live|twiml\/stream-status)\/([a-f0-9]{64})$/);
    if (routed) return env.CALLS.get(env.CALLS.idFromString(routed[1]!)).fetch(request);
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
      const result = await env.prosper_desk.prepare("SELECT count(*) AS count FROM voice_sessions WHERE expires_at > ?")
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
