import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { todayRange, recentRange, callCounts, originFilter, lineFilter, filterLine } from "./reporting.ts";
import { readStoredCalls } from "./call-query.ts";
import { callFromRow } from "./call-records.ts";
import { periodEconomics } from "./metrics.ts";

test("Madrid calendar days respect midnight and both DST transitions", () => {
  assert.deepEqual(todayRange(new Date("2026-09-19T22:30:00Z")), {
    day: "2026-09-20", from: "2026-09-19T22:00:00.000Z", to: "2026-09-20T22:00:00.000Z",
  });
  for (const [day, hours] of [["2026-03-29", 23], ["2026-10-25", 25]]) {
    const { from, to } = todayRange(new Date(`${day}T12:00:00Z`));
    assert.equal((Date.parse(to) - Date.parse(from)) / 3600000, hours);
  }
});

test("overview window covers the last seven Madrid days including Saturday activity", () => {
  const range = recentRange(new Date("2026-09-20T06:00:00Z"));
  assert.equal(range.day, "2026-09-20");
  assert.equal(range.days, 7);
  assert.equal(range.from, todayRange(new Date("2026-09-14T12:00:00Z")).from);
  assert.equal(range.to, todayRange(new Date("2026-09-20T12:00:00Z")).to);
  assert.ok(range.from < "2026-09-19T10:00:00.000Z");
  assert.ok("2026-09-19T10:00:00.000Z" < range.to);
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
  assert.equal(calls.find(call => call.id === "call-1").origin, "phone");
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
  assert.equal(map({}).origin, "phone");
  assert.equal(map({ origin: "unknown" }).origin, "phone");
  assert.equal(map({ origin: "simulator" }).origin, "simulator");
  assert.equal(map({ outcome: "sin_cierre" }).resolution, "unknown");
  assert.equal(originFilter("simulator"), "simulator");
  assert.equal(originFilter("constructor"), "all");
  assert.equal(lineFilter("desk"), "desk");
  assert.equal(lineFilter("phone"), "agent");
  assert.equal(lineFilter("simulator"), "all");
  const live = [
    { origin: "phone", outcome: "cita", minutes: 10 },
    { origin: "phone", outcome: "escalado", minutes: 6 },
    { origin: "simulator", outcome: "sin_cierre", minutes: 4 },
  ];
  assert.equal(filterLine(live, "all").length, 2);
  assert.equal(filterLine(live, "desk").length, 1);
  assert.equal(filterLine(live, "agent").every((call) => call.outcome !== "escalado"), true);
  const value = periodEconomics(filterLine(live, "all"));
  assert.equal(value.citas, 1);
  assert.equal(value.agenda, 90);
  assert.equal(value.savedLabor, 3);
  assert.equal(value.deskLabor, 1.8);
  assert.equal(value.effect, 93);
});

test("health keeps unavailable readings distinct from a measured zero", async () => {
  const { agentHealth } = await import("./agent-health.ts");
  const at = "2026-09-19T12:00:00Z";
  assert.deepEqual(agentHealth({ ok: true, activeCalls: 0 }, at), { ok: true, activeCalls: 0, uptimeSeconds: null, checkedAt: at });
  assert.equal(agentHealth({ ok: false, activeCalls: 0 }, at).activeCalls, null);
  assert.equal(agentHealth({ ok: true, uptimeSeconds: -1 }, at).uptimeSeconds, null);
});

test("consultations use recorded intent and UTC call times display in Madrid", async () => {
  const { byConsultation } = await import("./metrics.ts");
  const { timeOf, periodLabel } = await import("./format.ts");
  assert.deepEqual(byConsultation([{ motive: "Me duele la rodilla" }, { intent: "appointment_action" }]), [
    { name: "Sin clasificar", count: 1 }, { name: "Gestión de citas", count: 1 },
  ]);
  assert.equal(timeOf("2026-09-19T12:30:00Z"), "14:30");
  assert.equal(timeOf("2026-01-19T12:30:00Z"), "13:30");
  assert.equal(timeOf("2026-09-19T14:30:00,000 CEST"), "14:30");
  assert.equal(
    periodLabel("2026-09-13T22:00:00.000Z", "2026-09-20T22:00:00.000Z"),
    "lun, 14 sept – dom, 20 sept",
  );
});

test("open calls split by why they never closed", async () => {
  const { openBreakdown, outcomeWhy } = await import("./metrics.ts");
  assert.deepEqual(openBreakdown([
    { outcome: "sin_cierre", minutes: 0.2, toolCalls: 1 },
    { outcome: "sin_cierre", minutes: 2, toolCalls: 0 },
    { outcome: "sin_cierre", minutes: 4, toolCalls: 2 },
    { outcome: "cita", minutes: 5, toolCalls: 3 },
  ]), { open: 3, short: 1, noTools: 1, unfinished: 1 });
  assert.equal(outcomeWhy({
    outcome: "sin_cierre",
    reason: null,
    actions: [{ name: "search_availability", at: null, reason: null, summary: "ok" }],
  }), "Buscó hueco y no reservó");
  assert.equal(outcomeWhy({ outcome: "escalado", reason: "out_of_scope" }), "Fuera de alcance");
});

test("hospital hours form call peaks", async () => {
  const { hourlyPeaks, dailyPeaks } = await import("./reporting.ts");
  const hour = hourlyPeaks([
    { started: "2026-09-19T08:10:00.000Z" },
    { started: "2026-09-19T08:40:00.000Z" },
    { started: "2026-09-19T10:10:00.000Z" },
  ]);
  assert.equal(hour[0]?.value, 2);
  assert.equal(dailyPeaks([
    { started: "2026-09-19T10:00:00.000Z" },
  ], { from: "2026-09-19T00:00:00.000Z", days: 1 })[0]?.value, 1);
  const { peakTimeline } = await import("./reporting.ts");
  const series = peakTimeline([
    { started: "2026-09-19T08:10:00.000Z", outcome: "cita" },
    { started: "2026-09-19T08:40:00.000Z", outcome: "escalado" },
  ], { from: "2026-09-19T08:00:00.000Z", to: "2026-09-19T10:00:00.000Z" });
  assert.equal(series.length, 2);
  assert.equal(series[0]?.total, 2);
  assert.equal(series[0]?.escalado, 1);
});

test("duplicate turns within a second collapse to one", async () => {
  const { dedupeTurns } = await import("./transcript.ts");
  const turns = [
    { id: "a", at: "2026-09-20T00:49:43.000Z", speaker: "agent", text: "Clínica Arenal, buenos días." },
    { id: "b", at: "2026-09-20T00:49:43.400Z", speaker: "agent", text: "Clínica Arenal, buenos días." },
    { id: "c", at: "2026-09-20T00:49:47.000Z", speaker: "caller", text: "No, en Clínica Arenal." },
  ];
  assert.deepEqual(dedupeTurns(turns).map((turn) => turn.id), ["a", "c"]);
});
