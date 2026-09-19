import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import { env } from "../config.ts";
import { callLog, callLogError, LOG_FILE } from "./call-log.ts";
import { getLiveSession, hasPhoneJoined, outboundCallSid } from "./live-bridge.ts";
import { handleCall } from "./session.ts";
import { connectNodeSocket } from "./node-socket.ts";
import { handoffTwiml, joinStreamUrl, liveStreamTwiml, patientReplyTwiml, startCallMediaStream, wsUrlFromOrigin } from "./twilio-transfer.ts";
import { OperationsService } from "../operations/service.ts";
import { operationsOrigin } from "../operations/twilio.ts";

const operations = new OperationsService({
  origin: operationsOrigin,
  options: { connect: connectNodeSocket },
});

const startedAt = Date.now();

function requestHost(req: IncomingMessage) {
  return String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "127.0.0.1:7860")
    .split(",")[0]!
    .trim();
}

function requestProto(req: IncomingMessage) {
  return String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0]!.trim();
}

function publicOrigin(req: IncomingMessage) {
  const proto = requestProto(req) === "http" ? "http" : "https";
  return `${proto}://${requestHost(req)}`;
}

function streamUrls(req: IncomingMessage, join: string, org: string) {
  const origin = publicOrigin(req);
  const wsUrl = wsUrlFromOrigin(origin);
  const statusCallback = `${origin}/twiml/stream-status`;
  return { origin, wsUrl, statusCallback };
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/operations/")) {
    void (async () => {
      let body = "";
      for await (const chunk of req) {
        body += String(chunk);
        if (body.length > 4096) { res.writeHead(413); res.end(); return; }
      }
      const request = new Request(url, {
        method: req.method ?? "GET",
        headers: { authorization: String(req.headers.authorization ?? "") },
        ...(req.method === "POST" ? { body } : {}),
      });
      const response = await operations.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    })().catch(() => { res.writeHead(500); res.end(); });
    return;
  }
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
  if (url.pathname === "/twiml/patient-reply") {
    res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    res.end(patientReplyTwiml(url.searchParams.get("text") ?? undefined));
    return;
  }
  if (url.pathname === "/twiml/live") {
    const join = url.searchParams.get("join") ?? "";
    const org = url.searchParams.get("org") ?? "arenal";
    const { wsUrl, statusCallback } = streamUrls(req, join, org);
    callLog("twiml live", join.slice(0, 8), wsUrl);
    res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    res.end(liveStreamTwiml(wsUrl, join, org, statusCallback));
    getLiveSession(join)?.freezeDisplay();
    return;
  }
  if (url.pathname === "/twiml/stream-status") {
    void readBody(req).then((body) => {
      callLog("stream status", body.slice(0, 500));
      res.writeHead(204);
      res.end();
    });
    return;
  }
  if (url.pathname === "/twiml/call-status") {
    void readBody(req).then((body) => {
      const posted = new URLSearchParams(body);
      const callSid = posted.get("CallSid") ?? "";
      const callStatus = posted.get("CallStatus") ?? "";
      const join = url.searchParams.get("join") ?? "";
      const org = url.searchParams.get("org") ?? "arenal";
      callLog("call status", callStatus, callSid.slice(0, 10), join.slice(0, 8));
      res.writeHead(204);
      res.end();
      if (!callSid || !join) return;
      if (callStatus !== "in-progress" && callStatus !== "answered") return;
      if (hasPhoneJoined(join)) return;
      const { wsUrl, statusCallback } = streamUrls(req, join, org);
      setTimeout(() => {
        if (hasPhoneJoined(join)) return;
        void startCallMediaStream(callSid, joinStreamUrl(publicOrigin(req), join, org)).then((result) => {
          callLog(
            "rest stream",
            callSid.slice(0, 10),
            result?.ok ? "ok" : "fail",
            result?.status ?? 0,
            result?.error ?? "",
          );
        });
      }, 6_000);
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
  if (pathname.startsWith("/operations/phone/") && pathname.endsWith("/ws")) {
    if (!operations.phoneAllowed(new URL(req.url!, "http://localhost"))) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => { void operations.attachPhone(ws); });
    return;
  }
  if (pathname !== "/ws") { socket.destroy(); return; }
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
  void handleCall(socket, { connect: connectNodeSocket, requestUrl: req.url ?? "/ws" });
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
