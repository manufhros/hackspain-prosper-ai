import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { readRuntimeConfig, storeCallEvent } from "./storage.ts";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_desk_storage.sql", "0002_voice_calls.sql", "0003_agent_audit.sql", "0004_call_transcripts.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../desk/migrations/${name}`, import.meta.url), "utf8"));
  }
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            async run() { return statement.run(...values); },
            async all() { return { results: statement.all(...values) }; },
          };
        },
      };
    },
  };
  return { sqlite, db };
}

test("Workers share global FAQ and behavior while isolating hospital endpoints", async () => {
  const { sqlite, db } = database();
  try {
    const insert = sqlite.prepare("INSERT INTO desk_settings (key, value) VALUES (?, ?)");
    insert.run("agent-config", JSON.stringify({ active: { id: "v2", config: { escalationFails: 4, frustrationThreshold: 80, faq: [{ question: "Global?", answer: "Yes" }] } } }));
    insert.run("org-agent-config:arenal", JSON.stringify({ preCallEndpoint: "https://arenal.example/context", frustrationThreshold: 62, faq: [{ question: "When?", answer: "Monday" }] }));
    const arenal = await readRuntimeConfig(db, "arenal");
    const sanitas = await readRuntimeConfig(db, "sanitas");
    assert.equal(arenal.version, "v2");
    assert.equal(arenal.escalationFails, 4);
    assert.equal(arenal.frustrationThreshold, 80);
    assert.equal(arenal.preCallEndpoint, "https://arenal.example/context");
    assert.equal(arenal.faq.length, 1);
    assert.equal(sanitas.frustrationThreshold, 80);
    assert.equal(sanitas.preCallEndpoint, "");
    assert.deepEqual(sanitas.faq, [{ question: "Global?", answer: "Yes" }]);
    assert.deepEqual(arenal.faq, sanitas.faq);
  } finally { sqlite.close(); }
});

test("full transcripts survive retries, out-of-order writes and audit redaction", async () => {
  const { sqlite, db } = database();
  try {
    const turns = Array.from({ length: 20 }, (_, index) => ({
      eventId: `turn-${index}`, schemaVersion: 1, callId: "conversation", configVersion: "v2",
      occurredAt: "2026-09-19T12:00:00.000Z",
      type: index % 2 ? "conversation.agent" : "conversation.user",
      payload: { orgSlug: "arenal", sequence: index + 1, text: `Turn ${index}`, zeroRetention: true,
        ...(index === 0 ? { source: "simulator" } : {}) },
    }));
    for (const event of [...turns].reverse()) await storeCallEvent(db, event);
    await storeCallEvent(db, turns[0]);
    await storeCallEvent(db, { ...turns[0], eventId: "blank", payload: { text: "  " } });
    const rows = sqlite.prepare("SELECT * FROM voice_transcript_entries ORDER BY sequence").all();
    assert.equal(rows.length, 20);
    assert.deepEqual(rows.map(row => row.text), turns.map(turn => turn.payload.text));
    assert.equal(rows[0].speaker, "caller");
    assert.equal(rows[1].speaker, "agent");
    assert.ok(rows.every(row => row.org_slug === "arenal"));
    const audit = sqlite.prepare("SELECT payload FROM agent_events WHERE event_id = 'turn-0'").get();
    assert.equal(JSON.parse(audit.payload).text, "[redacted]");
  } finally { sqlite.close(); }
});

test("call summaries survive duplicate and out-of-order lifecycle events", async () => {
  const { sqlite, db } = database();
  try {
    const event = { eventId: "ended", schemaVersion: 1, callId: "call", configVersion: "v2", occurredAt: "2026-09-19T12:01:00.000Z" };
    const ended = { ...event, type: "call.ended", payload: { orgSlug: "sanitas", durationMs: 60_000, outcome: "cita" } };
    await storeCallEvent(db, ended);
    await storeCallEvent(db, { ...event, eventId: "started", type: "call.started", payload: { orgSlug: "sanitas" } });
    await storeCallEvent(db, ended);
    const rows = sqlite.prepare("SELECT * FROM voice_calls").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].org_slug, "sanitas");
    assert.equal(rows[0].started_at, "2026-09-19T12:00:00.000Z");
    assert.equal(JSON.parse(rows[0].summary).outcome, "cita");
    await storeCallEvent(db, { ...event, eventId: "handoff", type: "handoff.prepared", payload: { transcript: ["private"] } });
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM voice_calls").get().n, 1);
    const audit = sqlite.prepare("SELECT * FROM agent_events").all();
    assert.equal(audit.length, 3);
    assert.equal(JSON.parse(audit.find((row) => row.type === "handoff.prepared").payload).transcript, "[redacted]");
  } finally { sqlite.close(); }
});

test("lead inserts append independently and reject invalid JSON", () => {
  const { sqlite } = database();
  try {
    const insert = sqlite.prepare("INSERT INTO desk_events (id, kind, value) VALUES (?, ?, ?)");
    insert.run("one", "lead", '{"name":"One"}');
    insert.run("two", "lead", '{"name":"Two"}');
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM desk_events").get().n, 2);
    assert.throws(() => insert.run("three", "lead", "invalid json"));
  } finally { sqlite.close(); }
});
