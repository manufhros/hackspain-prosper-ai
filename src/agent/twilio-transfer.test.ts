import assert from "node:assert/strict";
import { test } from "node:test";
import { dialHumanUrl, handoffVoiceUrl } from "./twilio-transfer.ts";

test("trial originate uses a short HTTPS message Url", () => {
  const previous = process.env.TWILIO_HANDOFF_URL;
  delete process.env.TWILIO_HANDOFF_URL;
  try {
    const url = handoffVoiceUrl("Paciente Marta. Motivo out of scope.");
    assert.equal(url.startsWith("https://twimlets.com/message?Message="), true);
    assert.equal(url.includes("Twiml="), false);
    assert.equal(decodeURIComponent(url).includes("Paciente Marta"), true);
  } finally {
    if (previous === undefined) delete process.env.TWILIO_HANDOFF_URL;
    else process.env.TWILIO_HANDOFF_URL = previous;
  }
});

test("real-call redirect dials the human number via Url", () => {
  assert.equal(
    dialHumanUrl("+34687275510"),
    "https://twimlets.com/forward?PhoneNumber=%2B34687275510",
  );
});
