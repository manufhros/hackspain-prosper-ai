import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { env } from "../config.ts";
import { handleCall } from "./session.ts";
import { CallStore } from "../console/calls.ts";
import { ProviderSettings } from "../console/provider.ts";
import { createConsoleHandler } from "../console/http.ts";
import { fileURLToPath } from "node:url";

const calls = new CallStore(
  fileURLToPath(new URL("../../data/calls.json", import.meta.url)),
);
const provider = new ProviderSettings();
await Promise.all([calls.load(), provider.load()]);
const consoleHandler = createConsoleHandler(calls, provider);

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  void consoleHandler(req, res);
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  console.log("socket open", wss.clients.size, "live");
  socket.on("error", (error) => {
    console.error("twilio socket", error);
  });
  void handleCall(socket, calls, provider);
});

wss.on("error", (error) => {
  console.error("wss", error);
});

server.listen(env.port, "0.0.0.0", () => {
  console.log(`listening ws://0.0.0.0:${env.port}/ws`);
  console.log(`console http://localhost:${env.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    for (const call of calls.list())
      if (call.status === "active") calls.finish(call.id, "interrupted");
    void calls.flush().finally(() => process.exit(0));
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});
