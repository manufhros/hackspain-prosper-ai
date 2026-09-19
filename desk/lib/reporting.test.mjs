import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { todayRange, callCounts, originFilter } from "./reporting.ts";
import { readStoredCalls } from "./call-query.ts";
import { callFromRow } from "./call-records.ts";

test("Madrid calendar days respect midnight and both DST transitions", () => {
  assert.deepEqual(todayRange(new Date("2026-09-19T22:30:00Z")), {
    day: "2026-09-20", from: "2026-09-19T22:00:00.000Z", to: "2026-09-20T22:00:00.000Z",
  });
  for (const [day, hours] of [["2026-03-29", 23], ["2026-10-25", 25]]) {
    const { from, to } = todayRange(new Date(`${day}T12:00:00Z`));
    assert.equal((Date.parse(to) - Date.parse(from)) / 3600000, hours);
  }
});

test("overview includes more than 500 calls but never another date or clinic, and recovers simulator provenance", async t => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const name of ["0002_voice_calls.sql", "0003_agent_audit.sql"]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const insert = sqlite.prepare("INSERT INTO voice_calls (call_id, org_slug, started_at, summary) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 501; i++) insert.run(`call-${i}`, "arenal", "2026-09-19T10:00:00.000Z", JSON.stringify({ outcome: "cita" }));
  insert.run("yesterday", "arenal", "2026-09-18T10:00:00.000Z", "{}");
  insert.run("next-day", "arenal", "2026-09-19T22:00:00.000Z", "{}");
  insert.run("foreign", "other", "2026-09-19T10:00:00.000Z", "{}");
  sqlite.prepare("INSERT INTO agent_events VALUES (?, 1, ?, 'v1', 'conversation.user', ?, ?)")
    .run("event", "call-0", "2026-09-19T10:00:00Z", JSON.stringify({ orgSlug: "arenal", source: "simulator" }));
  sqlite.prepare("INSERT INTO agent_events VALUES (?, 1, ?, 'v1', 'conversation.user', ?, ?)")
    .run("foreign-event", "call-1", "2026-09-19T10:00:00Z", JSON.stringify({ orgSlug: "other", source: "simulator" }));
  const db = { prepare(sql) { return { bind: (...args) => ({ all: async () => ({ results: sqlite.prepare(sql).all(...args) }) }) }; } };
  const calls = await readStoredCalls(db, "arenal", todayRange(new Date("2026-09-19T12:00:00Z")));
  assert.equal(calls.length, 501);
  assert.equal(calls.find(call => call.id === "call-0").origin, "simulator");
  assert.equal(calls.find(call => call.id === "call-1").origin, "unknown");
  assert.equal(callCounts(calls).citas, 501);
  assert.equal(callCounts(calls).measured, 0);
  assert.equal((await readStoredCalls(db, "arenal")).length, 500);
});

test("missing, invalid and incomplete durations stay unknown; measured zero stays zero", () => {
  const map = summary => callFromRow({ call_id: "c", started_at: "2026-09-19", summary: JSON.stringify(summary) });
  for (const summary of [{}, { durationMs: -1 }, { durationMs: "60000" }, { durationMs: 60000, importIncomplete: true }]) assert.equal(map(summary).minutes, null);
  assert.equal(map({ durationMs: 0 }).minutes, 0);
  assert.equal(map({ durationMs: 900000 }).minutes, 15);
  assert.equal(map({ origin: "phone" }).origin, "phone");
  assert.equal(originFilter("simulator"), "simulator");
  assert.equal(originFilter("constructor"), "all");
});
