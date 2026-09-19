import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { env } from "../config.ts";
import { callLog, callLogError, LOG_FILE } from "./call-log.ts";
import { handleCall } from "./session.ts";

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
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
