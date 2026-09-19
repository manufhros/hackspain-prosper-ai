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
