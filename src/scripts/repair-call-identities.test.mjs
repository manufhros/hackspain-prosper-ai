import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildRepair, repairSql } from "./repair-call-identities.mjs";

test("repair fills missing identities without replacing named calls or concurrent changes", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE voice_calls (call_id TEXT PRIMARY KEY, org_slug TEXT, summary TEXT)");
  const rows = [
    { call_id: "one", org_slug: "arenal", summary: '{"outcome":"cita","durationMs":60000}' },
    { call_id: "named", org_slug: "arenal", summary: '{"patientName":"Existing"}' },
    { call_id: "race", org_slug: "arenal", summary: null },
    { call_id: "other-clinic", org_slug: "sanitas", summary: null },
  ];
  for (const row of rows) db.prepare("INSERT INTO voice_calls VALUES (?, ?, ?)").run(row.call_id, row.org_slug, row.summary);
  const imports = rows.map(row => ({ id: row.call_id, org: "arenal", summary: { patientName: "New Name", patientId: "P01" } }));
  const plan = buildRepair(rows, [], [], imports);
  assert.equal(plan.length, 2);
  db.exec("UPDATE voice_calls SET summary = '{\"patientName\":\"Concurrent\"}' WHERE call_id = 'race'");
  db.exec(repairSql(plan));
  db.exec(repairSql(plan));
  const result = db.prepare("SELECT * FROM voice_calls").all();
  assert.deepEqual(JSON.parse(result[0].summary), { outcome: "cita", durationMs: 60000, patientName: "New Name", patientId: "P01" });
  assert.equal(JSON.parse(result[1].summary).patientName, "Existing");
  assert.equal(JSON.parse(result[2].summary).patientName, "Concurrent");
  assert.equal(result[3].summary, null);
});

test("stored transcripts recover live calls and structured identity wins over spoken names", () => {
  const rows = [{ call_id: "one", org_slug: "arenal", summary: null }];
  const turns = [{ call_id: "one", org_slug: "arenal", speaker: "caller", text: "Me llamo María.", occurred_at: "2026-09-19" }];
  assert.equal(buildRepair(rows, turns, [])[0].identity.patientName, "María");
  const events = [{ call_id: "one", type: "patient.identified", occurred_at: "2026-09-19",
    payload: JSON.stringify({ orgSlug: "arenal", patientName: "María García", patientId: "P01" }) }];
  assert.equal(buildRepair(rows, turns, events)[0].identity.patientName, "María García");
});
