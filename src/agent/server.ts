import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { env } from "../config.ts";
import { callLog, callLogError, LOG_FILE } from "./call-log.ts";
import { handleCall } from "./session.ts";
import { handoffTwiml } from "./twilio-transfer.ts";
import { connectNodeSocket } from "./node-socket.ts";

const startedAt = Date.now();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      activeCalls: wss.clients.size,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checkedAt: new Date().toISOString(),
    }));
    return;
  }
  if (url.pathname === "/twiml/handoff") {
    res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    res.end(handoffTwiml(url.searchParams.get("summary") ?? undefined));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  callLog("socket open", wss.clients.size, "live");
  socket.on("error", (error) => {
    callLogError("twilio socket", error);
  });
  void handleCall(socket, { connect: connectNodeSocket });
});

wss.on("error", (error) => {
  callLogError("wss", error);
});

server.listen(env.port, "0.0.0.0", () => {
  callLog(`listening ws://0.0.0.0:${env.port}/ws`);
  callLog("log file", LOG_FILE);
});

process.on("unhandledRejection", (reason) => {
  callLogError("unhandledRejection", reason);
});
