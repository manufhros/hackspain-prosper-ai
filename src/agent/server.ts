import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { env } from "../config.ts";
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
  console.log("socket open", wss.clients.size, "live");
  socket.on("error", (error) => {
    console.error("twilio socket", error);
  });
  void handleCall(socket);
});

wss.on("error", (error) => {
  console.error("wss", error);
});

server.listen(env.port, "0.0.0.0", () => {
  console.log(`listening ws://0.0.0.0:${env.port}/ws`);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});
