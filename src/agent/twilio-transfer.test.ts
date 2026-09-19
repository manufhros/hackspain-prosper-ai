import assert from "node:assert/strict";
import { test } from "node:test";
import { dialHumanUrl, handoffVoiceUrl, joinStreamUrl, liveStreamTwiml, patientReplyFor, splitHandoffTranscript } from "./twilio-transfer.ts";

test("trial fallback message does not say out of scope", () => {
  const previous = process.env.TWILIO_HANDOFF_URL;
  delete process.env.TWILIO_HANDOFF_URL;
  try {
    const url = handoffVoiceUrl("Motivo out of scope.");
    const spoken = decodeURIComponent(url);
    assert.equal(url.startsWith("https://twimlets.com/message?Message="), true);
    assert.equal(spoken.includes("out of scope"), false);
    assert.equal(spoken.includes("compañera"), true);
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
  assert.equal(twiml.includes("Le pongo con recepción"), false);
  assert.equal(twiml.includes("¿Tienen hueco por la mañana?"), true);
  assert.equal(twiml.includes("¿es recepción?"), false);
  assert.equal(twiml.includes("<Pause length=\"2\"/>"), false);
  assert.equal((twiml.match(/<Say /g) ?? []).length, 2);
  assert.equal(twiml.includes("esa hora me viene muy bien"), true);
  assert.equal(twiml.includes("Polly.Sergio-Neural"), true);
  assert.equal(twiml.includes("<Connect>"), false);
  assert.equal(twiml.includes("<Stream"), false);
  assert.equal(twiml.includes("<Pause length=\"600\"/>"), true);
  assert.equal(
    joinStreamUrl("https://example.ngrok-free.app", "call-123", "quironsalud"),
    "wss://example.ngrok-free.app/ws/join/call-123/quironsalud",
  );
  assert.equal(twiml.includes("out of scope"), false);
});

test("handoff transcript keeps the patient and the receptionist apart", () => {
  const mixed = splitHandoffTranscript(
    "Hola, buenos días. Llamaba para pedir la primera cita de medicina general, lo antes posible. ¿Tienen hueco por la mañana? Claro. ¿Qué necesitas?",
  );
  assert.equal(mixed.patient?.includes("medicina general"), true);
  assert.equal(mixed.helper, "Claro. ¿Qué necesitas?");
  assert.deepEqual(splitHandoffTranscript("Sí, te cojo la cita."), { helper: "Sí, te cojo la cita." });
  assert.equal(patientReplyFor("Mmm."), undefined);
  assert.match(patientReplyFor("Te paso con mi compañera.") ?? "", /espero a tu compañera/);
  assert.match(patientReplyFor("¿Te viene bien a las 9:00?") ?? "", /esa hora/);
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
