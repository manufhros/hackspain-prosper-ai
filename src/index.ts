import { beginCall, dumpDebug, endCall, push, renameCall } from "./debug-log";
import { CallSession } from "./session";
import { WebSession, type LabEvent } from "./web-session";

type SocketData = {
  kind: "twilio" | "web";
  session: CallSession | WebSession | null;
  socketKey: string;
};

const port = Number(process.env.PORT ?? 7860);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

if (!process.env.PLATFORM_API_KEY) {
  throw new Error("PLATFORM_API_KEY is missing. Copy .env.example to .env.");
}
if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  throw new Error(
    "AI Gateway auth is missing. Set AI_GATEWAY_API_KEY (or run vercel env pull for VERCEL_OIDC_TOKEN).",
  );
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

Bun.serve<SocketData>({
  port,
  fetch(req, server) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === "/health") {
      return json({
        status: "ok",
        gateway: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
        clinic: Boolean(process.env.PLATFORM_API_KEY),
        ws: "/web",
        twilio: "/ws",
      });
    }
    if (url.pathname === "/debug") {
      return json(dumpDebug());
    }
    if (url.pathname === "/ws" || url.pathname === "/web") {
      const ok = server.upgrade(req, {
        data: {
          kind: url.pathname === "/web" ? "web" : "twilio",
          session: null,
          socketKey: crypto.randomUUID(),
        },
      });
      if (ok) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400, headers: cors });
    }
    return new Response("Prosper clinic agent. Connect at /ws or /web", { headers: cors });
  },
  websocket: {
    open(ws) {
      const { kind, socketKey } = ws.data;
      console.log("socket open", kind);
      beginCall(socketKey, kind);
      if (kind === "web") {
        ws.data.session = new WebSession((event: LabEvent) => {
          if (event.type === "ready") renameCall(socketKey, event.callId);
          const debug = event.type === "debug" ? event.event : undefined;
          push(socketKey, {
            t: debug?.t ?? new Date().toISOString(),
            source: "out",
            type: event.type,
            stage: debug?.stage,
            message:
              debug?.message ??
              (event.type === "error"
                ? event.message
                : event.type === "transcript"
                  ? `${event.role}: ${event.text}`
                  : event.type === "status"
                    ? event.status
                    : event.type === "tool"
                      ? event.tool.name
                      : event.type === "speak-text"
                        ? event.text
                        : event.type),
            ms: debug?.ms,
            data:
              event.type === "audio"
                ? { mime: event.mime, chars: event.data.length }
                : event.type === "debug"
                  ? event.event.data
                  : event.type === "tool"
                    ? event.tool
                    : event,
          });
          try {
            ws.send(JSON.stringify(event));
          } catch {
            /* closed */
          }
        });
        return;
      }
      ws.data.session = new CallSession(ws);
    },
    async message(ws, message) {
      if (ws.data.kind === "web") {
        try {
          const text = typeof message === "string" ? message : message.toString();
          const parsed = JSON.parse(text) as { type?: string; text?: string };
          if (parsed.type && parsed.type !== "audio") {
            push(ws.data.socketKey, {
              t: new Date().toISOString(),
              source: "in",
              type: parsed.type,
              stage: "client",
              message: parsed.type === "text" ? parsed.text : parsed.type,
              data: parsed,
            });
          }
        } catch {
          /* ignore */
        }
      }
      await ws.data.session?.onMessage(message);
    },
    close(ws) {
      endCall(ws.data.socketKey);
      ws.data.session?.close();
    },
  },
});

console.log(`listening on http://localhost:${port}  twilio /ws  lab /web`);
