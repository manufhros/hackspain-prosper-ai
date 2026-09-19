import test from "node:test";
import assert from "node:assert/strict";
import { WorkerSocket, connectWorkerSocket } from "./socket.ts";

class NativeSocket extends EventTarget {
  readyState = 1;
  sent = [];
  accepted = false;
  accept() { this.accepted = true; }
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

test("Workers transport forwards text, binary, close and errors to the call engine", () => {
  const native = new NativeSocket();
  const socket = new WorkerSocket(native);
  const messages = [];
  socket.on("message", (data) => messages.push(data.toString()));
  native.dispatchEvent(new MessageEvent("message", { data: "text" }));
  native.dispatchEvent(new MessageEvent("message", { data: new TextEncoder().encode("binary").buffer }));
  assert.deepEqual(messages, ["text", "binary"]);
  socket.send("outbound");
  assert.deepEqual(native.sent, ["outbound"]);
  let error;
  socket.on("error", (value) => { error = value; });
  native.dispatchEvent(new Event("error"));
  assert.ok(error instanceof Error);
  socket.close();
  assert.equal(socket.readyState, 3);
});

test("outbound Workers socket performs HTTPS Upgrade and accepts the transport", async (t) => {
  const native = new NativeSocket();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.toString(), "https://example.test/conversation?token=synthetic");
    assert.equal(options.headers.Upgrade, "websocket");
    return { webSocket: native, status: 101 };
  });
  const socket = await connectWorkerSocket("wss://example.test/conversation?token=synthetic");
  assert.equal(native.accepted, true);
  assert.equal(socket.readyState, 1);
  await assert.rejects(connectWorkerSocket("ws://example.test"), /secure/);
});
