import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleCall } from "../agent/session.ts";
import { DEFAULT_RUNTIME_CONFIG } from "../agent/runtime-config.ts";

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", code, reason);
  }
  message(value) { this.emit("message", JSON.stringify(value)); }
}

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test("shared call engine bridges audio and finalizes once across stop and close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  process.env.VOICE_STORAGE = "d1";
  process.env.PLATFORM_API_KEY = "test";
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.ELEVENLABS_AGENT_ID = "test";
  t.mock.method(globalThis, "fetch", async () => Response.json({ signed_url: "wss://example.test" }));
  const twilio = new Socket();
  const eleven = new Socket();
  const events = [];
  const tasks = [];
  let connections = 0;
  await handleCall(twilio, {
    connect: async () => { connections++; return eleven; },
    loadConfig: async () => ({ ...DEFAULT_RUNTIME_CONFIG, version: "test-v1" }),
    emitEvent: (type, callId, configVersion, payload) => { const event = { type, callId, configVersion, payload }; events.push(event); return event; },
    waitUntil: (task) => tasks.push(task),
  });
  const start = { event: "start", start: { streamSid: "stream", callSid: "call", customParameters: { org_slug: "sanitas" } } };
  twilio.message(start);
  twilio.message(start);
  twilio.message({ event: "media", media: { payload: "queued-audio" } });
  await settle();
  assert.equal(connections, 1);
  assert.equal(eleven.sent[0].dynamic_variables.config_version, "test-v1");
  assert.ok(eleven.sent.some((message) => message.user_audio_chunk === "queued-audio"));
  eleven.message({ type: "audio", audio_event: { audio_base_64: "reply-audio" } });
  assert.ok(twilio.sent.some((message) => message.media?.payload === "reply-audio"));
  twilio.message({ event: "stop" });
  twilio.close();
  await settle();
  t.mock.timers.tick(8_000);
  await Promise.all(tasks);
  assert.equal(events.filter((event) => event.type === "call.ended").length, 1);
  assert.equal(events.find((event) => event.type === "call.ended").payload.orgSlug, "sanitas");
  assert.equal(eleven.readyState, 3);
});

test("invalid start frames close without opening an upstream socket", async () => {
  const twilio = new Socket();
  await handleCall(twilio, { connect: async () => { throw new Error("must not connect"); } });
  twilio.message({ event: "start" });
  assert.equal(twilio.readyState, 3);
});

test("disconnect during upstream connection closes the late socket", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  process.env.VOICE_STORAGE = "d1";
  process.env.PLATFORM_API_KEY = "test";
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.ELEVENLABS_AGENT_ID = "test";
  t.mock.method(globalThis, "fetch", async () => Response.json({ signed_url: "wss://example.test" }));
  const twilio = new Socket();
  const eleven = new Socket();
  const tasks = [];
  let completeConnection;
  await handleCall(twilio, {
    connect: () => new Promise((resolve) => { completeConnection = resolve; }),
    loadConfig: async () => DEFAULT_RUNTIME_CONFIG,
    emitEvent: () => ({}),
    waitUntil: (task) => tasks.push(task),
  });
  twilio.message({ event: "start", start: { streamSid: "stream", callSid: "call" } });
  await settle();
  assert.ok(completeConnection);
  twilio.close();
  completeConnection(eleven);
  await Promise.all(tasks);
  t.mock.timers.tick(8_000);
  assert.equal(eleven.readyState, 3);
  assert.deepEqual(eleven.sent, []);
});
