import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { buildImport, importSql, timestamp } from "./import-call-logs.mjs";
import { readCallRecord } from "../../desk/lib/call-records.ts";

const id = "12345678-1234-1234-1234-123456789abc";
const line = (body, time = "10:00:00,000") => `[2026-09-19T${time} CEST] ${body}`;
const raw = (extra = []) => [line(`call start ${id} withheld`),
  line(`12345678 agent Buenos días.`, "10:00:00,100"),
  line(`12345678 user Quiero una cita para O'Brien.`, "10:00:01,000"), ...extra].join("\n");
const event = (type, payload, at = "2026-09-19T08:01:00Z") => JSON.stringify({
  eventId: `event-${type}`, schemaVersion: 1, callId: id, configVersion: "v2", type,
  occurredAt: at, payload,
});
function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const file of ["0002_voice_calls.sql", "0003_agent_audit.sql", "0004_call_transcripts.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../desk/migrations/${file}`, import.meta.url), "utf8"));
  }
  return sqlite;
}
const sources = (text, events = "") => new Map([["one.log", text], ["call-events.jsonl", events]]);

test("imports full transcripts in UTC, safely quotes SQL, and is readable by the dashboard", async (t) => {
  const text = raw([
    line(`12345678 agent Sí, tenemos una cita.`, "10:00:02,000"),
    line(`12345678 tool result submit_book {"call_id":"${id}","received_at":"2026-09-19T08:00:03Z","record":{"actions":[{"action":"BOOK","location_id":"centro"}]}}`, "10:00:03,000"),
    line(`12345678 elevenlabs closed 1000`, "10:00:04,000"),
  ]);
  const plan = buildImport(sources(text));
  assert.equal(plan.stats.calls, 1);
  assert.equal(plan.calls[0].summary.outcome, "cita");
  assert.equal(plan.calls[0].summary.site, "centro");
  assert.equal(plan.calls[0].summary.durationMs, 4000);
  assert.equal(plan.calls[0].startedAt, "2026-09-19T08:00:00.000Z");
  const sqlite = database(t);
  sqlite.exec(importSql(plan));
  sqlite.exec(importSql(plan));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM voice_calls").get().n, 1);
  const db = { prepare(sql) { return { bind: (...args) => ({
    first: async () => sqlite.prepare(sql).get(...args),
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
  }) }; } };
  const detail = await readCallRecord(db, "arenal", id);
  assert.equal(detail.transcriptTotal, 3);
  assert.equal(detail.transcript[1].text, "Quiero una cita para O'Brien.");
  assert.equal(detail.call.outcome, "cita");
  assert.equal(await readCallRecord(db, "sanitas", id), null);
});

test("selects conversations within a mixed file, excludes greeting loops and microphone checks", () => {
  const text = raw() + "\n" + [line("call start greetings-only"), line("greeting agent Hola."),
    line("greeting user Hello. Hola. Good morning."), line("greeting user Can you hear me?"),
    line("greeting user ...")].join("\n");
  const plan = buildImport(sources(text));
  assert.deepEqual(plan.calls.map((c) => c.id), [id]);
  assert.equal(plan.stats.skippedCalls, 1);
  const reviewed = sources(text);
  reviewed.set("import-exclusions.json", JSON.stringify({ [id]: "Developer test" }));
  assert.equal(buildImport(reviewed).calls.length, 0);
});

test("held bookings, attempted tools and flush messages never fabricate a completed booking", () => {
  const plan = buildImport(sources(raw([
    line('12345678 tool submit_book {"location_id":"sur"}'),
    line('12345678 tool result submit_book {"held":true,"record":{"actions":[{"action":"BOOK"}]}}'),
    line('12345678 flushed book on eleven close'),
  ])));
  assert.equal(plan.calls[0].summary.outcome, "sin_cierre");
  assert.equal(plan.calls[0].endedAt, null);
  assert.equal(plan.calls[0].summary.importIncomplete, true);
});

test("structured outcomes win, audits redact secrets, and duplicate source turns appear once", (t) => {
  const events = [event("call.ended", { outcome: "escalado", orgSlug: "sanitas", durationMs: 60000 }),
    event("conversation.user", { orgSlug: "sanitas", text: "Quiero una cita para O'Brien.", token: "secret-value" }, "2026-09-19T08:00:01Z")].join("\n");
  const plan = buildImport(sources(raw(), events));
  assert.equal(plan.calls[0].org, "sanitas");
  assert.equal(plan.calls[0].summary.outcome, "escalado");
  assert.equal(plan.calls[0].turns.length, 2);
  const sqlite = database(t);
  sqlite.exec(importSql(plan));
  const audit = JSON.parse(sqlite.prepare("SELECT payload FROM agent_events WHERE type = 'conversation.user'").get().payload);
  assert.equal(audit.token, "[redacted]");
  assert.equal(audit.text, "[redacted]");
  assert.equal(buildImport(sources(raw(), events), { org: "arenal" }).calls.length, 0);
});

test("an existing live call and its transcript remain untouched on ID collision", (t) => {
  const sqlite = database(t);
  sqlite.prepare("INSERT INTO voice_calls VALUES (?, 'sanitas', '2026-09-19T08:00:00Z', NULL, ?)")
    .run(id, '{"outcome":"en_curso"}');
  sqlite.exec(importSql(buildImport(sources(raw(), event("call.ended", { outcome: "cita" })))));
  const call = sqlite.prepare("SELECT * FROM voice_calls").get();
  assert.equal(call.org_slug, "sanitas");
  assert.equal(JSON.parse(call.summary).outcome, "en_curso");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM voice_transcript_entries").get().n, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM agent_events").get().n, 0);
});

test("short IDs resolve within their file and ambiguous prefixes are skipped", () => {
  const other = "12345678-aaaa-bbbb-cccc-123456789abc";
  const split = new Map([["one.log", raw()], ["two.log", raw().replaceAll(id, other)]]);
  assert.equal(buildImport(split).calls.length, 2);
  const ambiguous = sources(raw() + "\n" + line(`call start ${other}`));
  const plan = buildImport(ambiguous);
  assert.equal(plan.stats.ambiguousLines, 2);
  assert.equal(plan.calls.length, 0);
});

test("uses explicit organization ahead of greetings, and recognizes older clinic greetings", () => {
  const text = raw().replace("Buenos días.", "Clínica Quirón, buenos días.");
  assert.equal(buildImport(sources(text)).calls[0].org, "quironsalud");
  const explicit = line(`stream start ${id} {"call_id":"${id}","org_slug":"arenal"}`) + "\n" + text;
  assert.equal(buildImport(sources(explicit)).calls[0].org, "arenal");
});

test("rejects malformed events and timezone-less dates instead of silently importing corrupt data", () => {
  assert.throws(() => buildImport(sources(raw(), "{broken")), /Invalid structured event/);
  assert.throws(() => timestamp("2026-09-19T12:00:00"), /timezone/);
  assert.equal(timestamp("2026-01-19T10:00:00,000 CET"), "2026-01-19T09:00:00.000Z");
});

test("joins a rotated log to a unique full call ID from an earlier file", () => {
  const files = new Map([
    ["start.log", line(`call start ${id}`) + "\n" + line("12345678 agent Buenos días.")],
    ["rotated.log", line("12345678 user Quiero una cita.", "10:00:01,000") + "\n" +
      line("12345678 elevenlabs closed 1000", "10:00:02,000")],
  ]);
  const plan = buildImport(files);
  assert.equal(plan.stats.orphanLines, 0);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.calls[0].turns.length, 2);
  assert.equal(plan.calls[0].summary.durationMs, 2000);
});

test("imports names from complete and truncated directory results, never ambiguous candidates", (t) => {
  const patient = { given_name: "María", first_surname: "García", patient_id: "P01", insurer: "sanitas" };
  for (const result of [JSON.stringify({ matches: [patient] }), `{"matches":[${JSON.stringify(patient)}],"next_step":"truncated`]) {
    const plan = buildImport(sources(raw([line(`12345678 tool result search_directory ${result}`)])));
    assert.equal(plan.calls[0].summary.patientName, "María García");
    const sqlite = database(t);
    const oldPlan = structuredClone(plan);
    delete oldPlan.calls[0].summary.patientName;
    delete oldPlan.calls[0].summary.patientId;
    sqlite.exec(importSql(oldPlan));
    sqlite.exec(importSql(plan));
    sqlite.exec(importSql(plan));
    assert.equal(JSON.parse(sqlite.prepare("SELECT summary FROM voice_calls").get().summary).patientName, "María García");
  }
  for (const result of [JSON.stringify({ matches: [patient, patient] }), `{"matches":[${JSON.stringify(patient)},`]) {
    const plan = buildImport(sources(raw([line(`12345678 tool result search_directory ${result}`)])));
    assert.equal(plan.calls[0].summary.patientName, undefined);
  }
});

test("successful registrations recover the accepted patient's full name", () => {
  const result = { call_id: id, received_at: "2026-09-19T08:00:00Z", record: { actions: [{ action: "REGISTER", new_patient: {
    given_name: "Antonio", first_surname: "Ramírez", second_surname: "Jiménez", insurer: "cigna",
  } }] } };
  const plan = buildImport(sources(raw([line(`12345678 tool result submit_register ${JSON.stringify(result)}`)])));
  assert.equal(plan.calls[0].summary.patientName, "Antonio Ramírez Jiménez");
  assert.equal(plan.calls[0].summary.insurer, "cigna");
});

test("historical tool recovery is idempotent, preserves records, and labels truncated results", async (t) => {
  const { toolEventsSql } = await import("./import-call-logs.mjs");
  const { actionsFromEvents } = await import("../../desk/lib/call-tools.ts");
  const text = raw([
    line('12345678 tool search_directory {"name":"María","authorization":"secret"}', '10:00:02,000'),
    line('12345678 tool result search_directory {"matches":[]}', '10:00:02,100'),
    line('12345678 tool search_directory {"name":"María García"}', '10:00:02,200'),
    line('12345678 tool result search_directory {"matches":[', '10:00:02,300'),
  ]);
  const plan = buildImport(sources(text));
  const sqlite = database(t);
  sqlite.exec(toolEventsSql(plan));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM agent_events").get().n, 0);
  sqlite.prepare("INSERT INTO voice_calls VALUES (?, 'arenal', '2026-09-19', NULL, ?)").run(id, '{"patientName":"Existing"}');
  sqlite.exec(toolEventsSql(plan));
  sqlite.exec(toolEventsSql(plan));
  const events = sqlite.prepare("SELECT * FROM agent_events ORDER BY occurred_at").all();
  assert.equal(events.length, 4);
  assert.equal(JSON.parse(events[0].payload).parameters.authorization, "[redacted]");
  assert.equal(JSON.parse(events[0].payload).parameters.name, "[redacted]");
  const actions = actionsFromEvents(events);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].status, "completed");
  assert.equal(actions[1].status, "unknown");
  assert.equal(actions[1].result, undefined);
  assert.equal(JSON.parse(sqlite.prepare("SELECT summary FROM voice_calls").get().summary).patientName, "Existing");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM voice_transcript_entries").get().n, 0);
});

test("text logs enrich matching structured tools without duplicate entries", () => {
  const text = raw([line('12345678 tool search_directory {"name":"María"}', '10:01:00,000')]);
  const plan = buildImport(sources(text, event("tool.called", { name: "search_directory", orgSlug: "arenal" })));
  const tools = plan.calls[0].events.filter(event => event.type === "tool.called");
  assert.equal(tools.length, 1);
  assert.equal(tools[0].eventId, "event-tool.called");
  assert.equal(tools[0].payload.parameters.name, "María");
});
