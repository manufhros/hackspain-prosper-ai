import test from "node:test";
import assert from "node:assert/strict";
import { callLog, callLogError, callLogWarn } from "../agent/call-log.ts";

test("Workers console logging does not bypass D1 redaction with raw call details", (t) => {
  const previous = process.env.VOICE_STORAGE;
  process.env.VOICE_STORAGE = "d1";
  t.after(() => {
    if (previous === undefined) delete process.env.VOICE_STORAGE;
    else process.env.VOICE_STORAGE = previous;
  });
  const logs = [];
  for (const level of ["log", "warn", "error"]) {
    t.mock.method(console, level, (...parts) => logs.push({ level, parts }));
  }
  callLog("user", "private transcript", { patient_id: "private patient" });
  callLogWarn("tool result", "private phone");
  callLogError("provider error", new Error("private token"));
  assert.equal(logs.length, 2);
  assert.equal(logs.some((entry) => entry.level === "log"), false);
  assert.equal(JSON.stringify(logs).includes("private"), false);
  assert.equal(JSON.parse(logs[0].parts[0]).event, "voice.warning");
  assert.equal(JSON.parse(logs[1].parts[0]).event, "voice.error");
});
