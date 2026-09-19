import { assertGatewayAuth, env } from "./config.ts";
import { TwilioSession } from "./telephony/twilio-session.ts";

assertGatewayAuth();

type SocketData = { session: TwilioSession | null };

const server = Bun.serve<SocketData>({
  port: env.port,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, ws: "/ws" });
    }
    if (url.pathname === "/ws") {
      return srv.upgrade(req, { data: { session: null } })
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.data.session = new TwilioSession(ws);
    },
    message(ws, message) {
      void ws.data.session?.onMessage(
        typeof message === "string" ? message : Buffer.from(message),
      );
    },
    close(ws) {
      ws.data.session?.close();
      ws.data.session = null;
    },
  },
});

console.log(`white-label voice agent on ws://0.0.0.0:${server.port}/ws`);
