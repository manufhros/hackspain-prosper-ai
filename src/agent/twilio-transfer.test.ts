import assert from "node:assert/strict";
import { test } from "node:test";
import { dialHumanUrl, handoffVoiceUrl, joinStreamUrl, liveStreamTwiml, patientReplyFor, phoneHelperTranscript, publicHttpOrigin, splitHandoffTranscript } from "./twilio-transfer.ts";

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

test("Node handoff TwiML connects the phone both ways so the agent can reply", () => {
  const twiml = liveStreamTwiml(
    "wss://example.ngrok-free.app/ws",
    "call-123",
    "quironsalud",
    "https://example.ngrok-free.app/twiml/stream-status",
    true,
  );
  assert.equal(twiml.includes("Le pongo con recepción"), false);
  assert.equal(twiml.includes("<Say "), true);
  assert.equal(twiml.includes("Clínica Arenal"), true);
  assert.equal(twiml.includes("<Start>"), false);
  assert.equal(twiml.includes("<Pause"), true);
  assert.equal(twiml.includes("Polly.Sergio-Neural"), true);
  assert.equal(twiml.includes("<Connect>"), true);
  assert.equal(twiml.includes("<Stream"), true);
  assert.equal(twiml.includes("inbound_track"), false);
  assert.equal(twiml.includes('name="join" value="call-123"'), true);
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
  assert.equal(phoneHelperTranscript("Sí, esa hora me viene muy bien. Gracias."), "Sí, esa hora me viene muy bien. Gracias.");
  assert.equal(phoneHelperTranscript("Sí, le viene bien a las 9"), "Sí, le viene bien a las 9");
  assert.equal(phoneHelperTranscript("Hola, buenos días. Llamaba para pedir la primera cita de medicina general, lo antes posible. ¿Tienen hueco por la mañana?"), null);
  assert.equal(phoneHelperTranscript("Sí, te cojo la cita."), "Sí, te cojo la cita.");
});

test("real-call redirect dials the human number via Url", () => {
  assert.equal(
    dialHumanUrl("+34687275510"),
    "https://twimlets.com/forward?PhoneNumber=%2B34687275510",
  );
});

test("live handoff escapes XML attribute values", () => {
  const twiml = liveStreamTwiml('wss://example.test/ws/one', 'call"<&', 'org"', undefined, true);
  assert.ok(twiml.includes('value="call&quot;&lt;&amp;"'));
  assert.ok(twiml.includes('value="org&quot;"'));
});

test("publicHttpOrigin skips localhost env and uses the ngrok https tunnel", async (t) => {
  const keys = ["VOICE_AGENT_PUBLIC_URL", "TWILIO_HANDOFF_URL", "VOICE_STORAGE"] as const;
  const previous = keys.map((key) => process.env[key]);
  process.env.VOICE_AGENT_PUBLIC_URL = "ws://127.0.0.1:7860/ws";
  delete process.env.TWILIO_HANDOFF_URL;
  delete process.env.VOICE_STORAGE;
  t.after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    assert.equal(String(url), "http://127.0.0.1:4040/api/tunnels");
    return Response.json({
      tunnels: [
        { public_url: "https://wrong.ngrok-free.app", config: { addr: "http://localhost:7861" } },
        { public_url: "https://voice.ngrok-free.app", config: { addr: "http://localhost:7860" } },
      ],
    });
  });
  assert.equal(await publicHttpOrigin(), "https://voice.ngrok-free.app");
});

test("ngrok selects this instance port and never another server", async (t) => {
  const keys = ["VOICE_AGENT_PUBLIC_URL", "TWILIO_HANDOFF_URL", "VOICE_STORAGE", "PORT"] as const;
  const previous = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
  }));
  process.env.VOICE_AGENT_PUBLIC_URL = "ws://localhost:7862/ws";
  delete process.env.TWILIO_HANDOFF_URL;
  delete process.env.VOICE_STORAGE;
  process.env.PORT = "7862";
  t.mock.method(globalThis, "fetch", async () => Response.json({ tunnels: [
    { public_url: "https://old.example", config: { addr: "http://localhost:7860" } },
    { public_url: "https://current.example", config: { addr: "http://localhost:7862" } },
  ] }));
  assert.equal(await publicHttpOrigin(), "https://current.example");
  process.env.PORT = "7899";
  assert.equal(await publicHttpOrigin(), null);
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
