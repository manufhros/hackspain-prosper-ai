import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { readCallRecord, callFromRow } from "./call-records.ts";
import { storeCallEvent } from "../../src/worker/storage.ts";

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const name of ["0002_voice_calls.sql", "0003_agent_audit.sql", "0004_call_transcripts.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind: (...values) => ({
        first: async () => statement.get(...values) ?? null,
        all: async () => ({ results: statement.all(...values) }),
        run: async () => statement.run(...values),
      }) };
    },
  };
}

function event(id, type, payload = {}) {
  return { eventId: id, callId: "call", schemaVersion: 1, configVersion: "v1",
    occurredAt: "2026-09-19T12:01:00.000Z", type, payload: { orgSlug: "arenal", ...payload } };
}

test("list and detail mapping expose the stored patient identity", () => {
  const call = callFromRow({ call_id: "call", started_at: "2026-09-19", summary: JSON.stringify({ patientName: "María García", patientId: "P01", insurer: "sanitas" }) });
  assert.equal(call.patient, "María García");
  assert.equal(call.patientId, "P01");
  assert.equal(call.insurer, "sanitas");
});

test("stored caller and agent text is read in order, paginated, and scoped to the clinic", async (t) => {
  const db = database(t);
  await storeCallEvent(db, event("start", "call.started"));
  for (let sequence = 102; sequence >= 1; sequence--) {
    await storeCallEvent(db, event(`turn-${sequence}`, sequence % 2 ? "conversation.user" : "conversation.agent",
      { text: `Text ${sequence}`, sequence, zeroRetention: true }));
  }
  // A different clinic's event must not leak even with a matching call ID.
  await storeCallEvent(db, event("other-clinic", "conversation.user", {
    orgSlug: "sanitas", text: "Other clinic", sequence: 1,
  }));
  await storeCallEvent(db, event("end", "call.ended", { durationMs: 60_000, outcome: "escalado" }));
  const first = await readCallRecord(db, "arenal", "call");
  assert.equal(first.call.minutes, 1);
  assert.equal(first.call.outcome, "escalado");
  assert.equal(first.transcriptTotal, 102);
  assert.equal(first.pages, 2);
  assert.equal(first.transcript.length, 100);
  assert.equal(first.transcript[0].text, "Text 1");
  assert.equal(first.transcript[0].speaker, "caller");
  assert.equal(first.transcript[1].speaker, "agent");
  const last = await readCallRecord(db, "arenal", "call", 999);
  assert.equal(last.page, 2);
  assert.deepEqual(last.transcript.map(turn => turn.text), ["Text 101", "Text 102"]);
  for (const page of [NaN, -1, 1.5, Infinity]) {
    assert.equal((await readCallRecord(db, "arenal", "call", page)).page, 1);
  }
  assert.equal(await readCallRecord(db, "sanitas", "call"), null);
  assert.equal(await readCallRecord(db, "arenal", "missing"), null);
  assert.equal(await readCallRecord(db, "arenal", "' OR 1=1 --"), null);
});

test("historical and in-progress calls expose an honest empty transcript", async (t) => {
  const db = database(t);
  await storeCallEvent(db, event("start", "call.started"));
  const active = await readCallRecord(db, "arenal", "call");
  assert.equal(active.call.outcome, "en_curso");
  assert.equal(active.transcriptTotal, 0);
  assert.deepEqual(active.transcript, []);
  await storeCallEvent(db, event("end", "call.ended", { durationMs: 1_000, outcome: "sin_cierre" }));
  const historical = await readCallRecord(db, "arenal", "call");
  assert.equal(historical.call.outcome, "sin_cierre");
  assert.deepEqual(historical.transcript, []);
});

test("call detail pairs tools by ID, keeps repeated invocations and excludes other clinics", async (t) => {
  const db = database(t);
  await storeCallEvent(db, event("start", "call.started"));
  for (const [id, type, payload] of [
    ["received", "tool.received", { toolCallId: "a", toolName: "search_directory", parameters: { name: "Private", phone: "123" } }],
    ["called", "tool.called", { toolCallId: "a", toolName: "search_directory" }],
    ["result", "tool.completed", { toolCallId: "a", toolName: "search_directory", ok: true, latencyMs: 123, result: { matches: [] } }],
    ["received-2", "tool.received", { toolCallId: "b", toolName: "search_directory", parameters: {} }],
    ["failed", "tool.failed", { toolCallId: "b", toolName: "search_directory", ok: false }],
    ["blocked", "tool.blocked", { toolCallId: "c", toolName: "submit_book", reason: "action_tools_disabled" }],
    ["foreign", "tool.called", { orgSlug: "sanitas", toolCallId: "foreign", toolName: "search_directory" }],
  ]) await storeCallEvent(db, event(id, type, payload));
  const { call } = await readCallRecord(db, "arenal", "call");
  assert.equal(call.actions.length, 3);
  assert.equal(call.actions[0].status, "completed");
  assert.equal(call.actions[0].latencyMs, 123);
  assert.deepEqual(call.actions[0].result, { matches: [] });
  assert.deepEqual(call.actions[0].parameters, { name: "[redacted]", phone: "[redacted]" });
  assert.equal(call.actions[1].status, "failed");
  assert.equal(call.actions[2].status, "blocked");
});
