import assert from "node:assert/strict";
import { test } from "node:test";
import { dialHumanUrl, handoffVoiceUrl, liveStreamTwiml } from "./twilio-transfer.ts";

test("trial fallback message does not say out of scope", () => {
  const previous = process.env.TWILIO_HANDOFF_URL;
  delete process.env.TWILIO_HANDOFF_URL;
  try {
    const url = handoffVoiceUrl("Motivo out of scope.");
    const spoken = decodeURIComponent(url);
    assert.equal(url.startsWith("https://twimlets.com/message?Message="), true);
    assert.equal(spoken.includes("out of scope"), false);
    assert.equal(spoken.includes("compañero"), true);
  } finally {
    if (previous === undefined) delete process.env.TWILIO_HANDOFF_URL;
    else process.env.TWILIO_HANDOFF_URL = previous;
  }
});

test("live handoff TwiML streams into the existing call", () => {
  const twiml = liveStreamTwiml(
    "wss://example.ngrok-free.app/ws",
    "call-123",
    "quironsalud",
    "https://example.ngrok-free.app/twiml/stream-status",
  );
  assert.equal(twiml.includes("<Say"), false);
  assert.equal(twiml.includes('Le pongo con recepción'), false);
  assert.equal(twiml.includes("<Stream url=\"wss://example.ngrok-free.app/ws\""), true);
  assert.equal(twiml.includes('statusCallback="https://example.ngrok-free.app/twiml/stream-status"'), true);
  assert.equal(twiml.includes('name="join" value="call-123"'), true);
  assert.equal(twiml.includes("out of scope"), false);
});

test("real-call redirect dials the human number via Url", () => {
  assert.equal(
    dialHumanUrl("+34687275510"),
    "https://twimlets.com/forward?PhoneNumber=%2B34687275510",
  );
});

test("live handoff escapes XML attribute values", () => {
  const twiml = liveStreamTwiml('wss://example.test/ws/one', 'call"<&', 'org"');
  assert.ok(twiml.includes('value="call&quot;&lt;&amp;"'));
  assert.ok(twiml.includes('value="org&quot;"'));
});

test("Worker handoff uses its Durable Object callback and retains provider auditing", async (t) => {
  const { transferTwilioCall } = await import("./twilio-transfer.ts");
  const keys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_HUMAN_NUMBER", "TWILIO_PHONE_NUMBER"];
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key) => { process.env[key] = "test"; });
  t.after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
  const requests: URLSearchParams[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    requests.push(init?.body as URLSearchParams);
    return Response.json({ sid: "outbound" });
  });
  const events: string[] = [];
  const result = await transferTwilioCall(undefined, {
    callId: "original", orgSlug: "arenal", handoffUrl: "https://desk.example/twiml/live/object-id",
  }, async (type) => { events.push(type); });
  assert.ok(result.configured && result.transferred);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.get("Url"), "https://desk.example/twiml/live/object-id?join=original&org=arenal");
  assert.deepEqual(events, ["handoff.requested", "handoff.completed"]);
});
