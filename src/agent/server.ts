import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { env } from "../config.ts";
import { callLog, callLogError, LOG_FILE } from "./call-log.ts";
import { handleCall } from "./session.ts";
import { handoffTwiml, liveStreamTwiml } from "./twilio-transfer.ts";

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
  if (url.pathname === "/twiml/live") {
    const join = url.searchParams.get("join") ?? "";
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "127.0.0.1:7860")
      .split(",")[0]!
      .trim();
    const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0]!.trim();
    const wsUrl = `${proto === "http" ? "ws" : "wss"}://${host}/ws`;
    const statusCallback = `${proto === "http" ? "http" : "https"}://${host}/twiml/stream-status`;
    callLog("twiml live", join.slice(0, 8), wsUrl);
    res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    res.end(liveStreamTwiml(wsUrl, join, url.searchParams.get("org") ?? "arenal", statusCallback));
    return;
  }
  if (url.pathname === "/twiml/stream-status") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      callLog("stream status", Buffer.concat(chunks).toString("utf8").slice(0, 500));
      res.writeHead(204);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
});

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  callLog(
    "ws upgrade",
    pathname,
    req.headers["user-agent"] ?? "no-ua",
    req.headers["sec-websocket-extensions"] ?? "no-ext",
  );
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (socket, req) => {
  callLog("socket open", wss.clients.size, req.url ?? "/ws", req.headers["user-agent"] ?? "no-ua");
  socket.on("error", (error) => {
    callLogError("twilio socket", error);
  });
  void handleCall(socket);
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
