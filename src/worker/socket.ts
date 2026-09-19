import { EventEmitter } from "node:events";
import type { CallSocket } from "../agent/socket.ts";

/** Adapt Workers' EventTarget WebSockets to the call engine's event interface. */
export class WorkerSocket extends EventEmitter implements CallSocket {
  constructor(private readonly socket: WebSocket) {
    super();
    // EventEmitter throws unhandled error events. Always retain a last-resort handler.
    this.on("error", () => {});
    socket.addEventListener("message", (event) => {
      this.emit("message", typeof event.data === "string" ? event.data : Buffer.from(event.data));
    });
    socket.addEventListener("close", (event) => this.emit("close", event.code, event.reason));
    socket.addEventListener("error", () => this.emit("error", new Error("WebSocket transport error")));
  }

  get readyState() { return this.socket.readyState; }
  send(data: string) { this.socket.send(data); }
  close(code = 1000, reason = "") { this.socket.close(code, reason); }
}

export async function connectWorkerSocket(url: string): Promise<CallSocket> {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "wss:") throw new Error("Expected a secure ElevenLabs WebSocket URL");
  endpoint.protocol = "https:";
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("ElevenLabs WebSocket connection timed out", "TimeoutError"));
  }, 12_000);
  try {
    const response = await fetch(endpoint, {
      headers: { Upgrade: "websocket" },
      signal: controller.signal,
      // workerd supports follow/manual only. Do not follow a signed URL to another host.
      redirect: "manual",
    });
    const socket = response.webSocket;
    if (!socket) throw new Error(`ElevenLabs WebSocket upgrade failed (${response.status})`);
    const adapter = new WorkerSocket(socket);
    socket.accept();
    return adapter;
  } finally {
    // Workers keeps the abort signal attached to the upgraded WebSocket.
    // Limit connection setup only; an armed timer would cut off the active call.
    clearTimeout(timer);
  }
}
