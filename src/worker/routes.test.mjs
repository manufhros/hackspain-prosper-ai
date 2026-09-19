import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Exercise routing without launching workerd or connecting to provider services.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: "test:cloudflare", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "test:cloudflare") return { format: "module", source: "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
    return next(url, context);
  },
});
const { default: worker, VoiceCall } = await import("./index.ts");
hooks.deregister();
const id = "a".repeat(64);

test("phone callbacks and WebSocket joins route to the original Durable Object", async () => {
  const seen = [];
  const env = { CALLS: {
    idFromString(value) { return value; },
    get(value) { seen.push(value); return { fetch: async () => new Response("routed") }; },
    newUniqueId() { assert.fail("must reuse original call"); },
  } };
  for (const path of ["ws", "twiml/live", "twiml/stream-status"]) {
    const response = await worker.fetch(new Request(`https://voice.example/${path}/${id}`), env);
    assert.equal(await response.text(), "routed");
  }
  assert.deepEqual(seen, [id, id, id]);
});

test("live TwiML uses a query-free WebSocket path and audits stream callbacks", async () => {
  const call = new VoiceCall({ id: { toString: () => id } }, {});
  const events = [];
  const url = `https://desk.example/twiml/live/${id}?join=original&org=arenal`;
  assert.equal((await call.fetch(new Request(url))).status, 404);
  call.bridge.registerLiveSession({ callId: "original", audit: async (type, payload) => events.push({ type, payload }) });
  const response = await call.fetch(new Request(url));
  const twiml = await response.text();
  assert.ok(twiml.includes(`<Stream url="wss://desk.example/ws/${id}"`));
  assert.ok(twiml.includes('name="join" value="original"'));
  assert.ok(twiml.includes(`/twiml/stream-status/${id}?join=original`));
  const status = await call.fetch(new Request(`https://desk.example/twiml/stream-status/${id}?join=original`, {
    method: "POST", body: new URLSearchParams({ StreamEvent: "stream-started", StreamSid: "stream" }),
  }));
  assert.equal(status.status, 204);
  assert.deepEqual(events, [{ type: "handoff.stream.status", payload: { provider: "twilio", event: "stream-started", streamSid: "stream" } }]);
});
