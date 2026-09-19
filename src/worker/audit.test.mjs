import test from "node:test";
import assert from "node:assert/strict";
import { auditPayload } from "./audit.ts";
import { PlatformClient } from "../platform/client.ts";

test("audit preserves action details while redacting personal data and secrets", () => {
  const payload = {
    toolName: "submit_book", toolCallId: "tool-1",
    parameters: { patient_id: "private", slot: "2026-09-20", phone: "private" },
    result: { email: "private", api_key: "secret", accepted: true },
    endpoint: "https://user:pass@example.test/hook?token=secret&call_id=one",
  };
  const result = auditPayload(payload, true);
  assert.equal(result.toolName, "submit_book");
  assert.equal(result.parameters.slot, "2026-09-20");
  assert.equal(result.parameters.patient_id, "[redacted]");
  assert.equal(result.result.api_key, "[redacted]");
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.ok(!JSON.stringify(result).includes("private"));
  const retained = auditPayload(payload, false);
  assert.equal(retained.parameters.patient_id, "private");
  assert.equal(retained.result.api_key, "[redacted]");
});

test("provider action is not executed if its audit entry cannot be persisted", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({ accepted: true }); });
  const client = new PlatformClient("https://example.test", "test", async () => { throw new Error("D1 unavailable"); });
  await assert.rejects(client.submitNoAction({ call_id: "call", reason: "out_of_scope" }), /D1 unavailable/);
  assert.equal(requests, 0);
});

test("audit failure after provider success never retries the provider action", async (t) => {
  let requests = 0;
  const events = [];
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({ accepted: true }); });
  const client = new PlatformClient("https://example.test", "test", async (type, payload) => {
    events.push({ type, payload });
    if (type === "api.completed") throw new Error("D1 unavailable");
  });
  await assert.rejects(client.submitNoAction({ call_id: "call", reason: "out_of_scope" }), /D1 unavailable/);
  assert.equal(requests, 1);
  assert.equal(events[0].payload.requestId, events[1].payload.requestId);
  assert.ok(!JSON.stringify(events).includes("X-Api-Key"));
});

test("concurrent tools retain separate correlation IDs across async provider calls", async () => {
  const { withAuditContext, currentAuditContext } = await import("../agent/audit.ts");
  const contexts = await Promise.all(["tool-one", "tool-two"].map((toolCallId) =>
    withAuditContext({ toolCallId }, async () => {
      await Promise.resolve();
      return currentAuditContext().toolCallId;
    }),
  ));
  assert.deepEqual(contexts, ["tool-one", "tool-two"]);
  assert.deepEqual(currentAuditContext(), {});
});
