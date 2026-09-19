import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleCall } from "../agent/session.ts";
import { DEFAULT_RUNTIME_CONFIG } from "../agent/runtime-config.ts";
import { LiveBridge } from "../agent/live-bridge.ts";
import { runClinicTool } from "../agent/tools.ts";
import { PlatformClient } from "../platform/client.ts";

class Socket extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, any>> = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit("close", 1000, ""); }
  input(value: unknown) { this.emit("message", JSON.stringify(value)); }
}
const settle = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

test("demo uses real shared engine and blocks all booking writes and external hooks", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  process.env.VOICE_STORAGE = "d1";
  process.env.PLATFORM_API_KEY = "test";
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.ELEVENLABS_AGENT_ID = "test";
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    requests.push(String(url));
    assert.ok(!options?.method || options.method === "GET", "demo must never POST to Prosper or hooks");
    if (String(url).includes("get-signed-url")) return Response.json({ signed_url: "wss://test.example" });
    if (String(url).includes("availability")) return Response.json({ slots: [] });
    throw new Error("Unexpected remote request");
  });
  const caller = new Socket(), eleven = new Socket();
  const events: Record<string, unknown>[] = [];
  await handleCall(caller, {
    demo: true, textOnly: true, liveBridge: new LiveBridge(), connect: async () => eleven,
    onMonitor: event => events.push(event),
    loadConfig: async () => ({ ...DEFAULT_RUNTIME_CONFIG, preCallEndpoint: "https://hooks.example/pre", postCallWebhook: true, postCallEndpoint: "https://hooks.example/post" }),
    emitEvent: (type, callId, configVersion, payload = {}) => ({ eventId: "test", schemaVersion: 1, type, callId, configVersion, payload, occurredAt: new Date().toISOString() }),
  });
  caller.input({ event: "start", start: { callSid: "demo-one", streamSid: "stream" } });
  await settle();
  assert.equal(eleven.sent[0]?.conversation_config_override.conversation.text_only, true);
  eleven.input({ type: "conversation_initiation_metadata" });
  assert.ok(events.some(event => event.type === "ready"));
  eleven.input({ type: "client_tool_call", client_tool_call: { tool_name: "submit_book", tool_call_id: "book", parameters: {
    patient_id: "P00001", provider_id: "PR01", location_id: "centro", appointment_type_id: "review",
    slot: "2040-09-21T11:00:00+02:00", policy_id: "mapfre",
  } } });
  await settle();
  const result = eleven.sent.find(message => message.tool_call_id === "book");
  assert.ok(result, "real core must return a tool result");
  assert.equal(JSON.parse(result.result).simulated, true);
  caller.close(); await settle(); t.mock.timers.tick(8000); await settle();
  assert.ok(!requests.some(url => url.includes("hooks.example")));
});

test("demo escalation cannot ring a human or submit a real escalation", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No external calls allowed"); });
  const result = JSON.parse(await runClinicTool({
    callId: "demo-escalate", platform: new PlatformClient(), demo: true,
  }, "submit_escalate", { reason: "out_of_scope" }));
  assert.equal(result.simulated, true);
  assert.equal(result.transfer.transferred, false);
  assert.equal(result.transfer.originated, false);
});
