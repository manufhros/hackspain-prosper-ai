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

function mockConnectionClock(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Node's built-in AbortSignal.timeout uses an internal clock. Route it through
  // the mock clock so this regression also catches the old uncancellable timer.
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
}

test("an upgraded WebSocket remains usable beyond the connection timeout", async (t) => {
  mockConnectionClock(t);
  const native = new NativeSocket();
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    // Workers keeps the request's abort signal attached to its upgraded socket.
    signal.addEventListener("abort", () => native.close(), { once: true });
    return { webSocket: native, status: 101 };
  });
  const socket = await connectWorkerSocket("wss://example.test/conversation");
  t.mock.timers.tick(60_000);
  assert.equal(signal.aborted, false);
  assert.equal(socket.readyState, 1);
  socket.send("still connected");
  assert.deepEqual(native.sent, ["still connected"]);
});

test("a stalled WebSocket upgrade still times out after twelve seconds", async (t) => {
  mockConnectionClock(t);
  let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const connection = connectWorkerSocket("wss://example.test/conversation");
  const rejected = assert.rejects(connection, { name: "TimeoutError" });
  t.mock.timers.tick(11_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
});

test("a failed connection clears its timer without masking the fetch error", async (t) => {
  mockConnectionClock(t);
  const failure = new Error("Network failure");
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    throw failure;
  });
  await assert.rejects(connectWorkerSocket("wss://example.test/conversation"), error => error === failure);
  t.mock.timers.tick(60_000);
  assert.equal(signal.aborted, false);
});

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
    assert.equal(options.redirect, "manual");
    return { webSocket: native, status: 101 };
  });
  const socket = await connectWorkerSocket("wss://example.test/conversation?token=synthetic");
  assert.equal(native.accepted, true);
  assert.equal(socket.readyState, 1);
  await assert.rejects(connectWorkerSocket("ws://example.test"), /secure/);
});

test("outbound Workers socket rejects redirects without following a signed URL", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests++;
    assert.equal(options.redirect, "manual");
    return { webSocket: null, status: 302 };
  });
  await assert.rejects(connectWorkerSocket("wss://example.test/conversation?token=synthetic"), /upgrade failed \(302\)/);
  assert.equal(requests, 1);
});
