import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MetricsStore } from "./metrics.ts";
import { CallStore, type Call, type ToolRun } from "./calls.ts";

const call = (id: string, startedAt = "2026-09-19T08:00:00Z"): Call => ({
  id,
  name: "Private name",
  phone: "private phone",
  startedAt,
  endedAt: "2026-09-19T08:02:00Z",
  connected: true,
  status: "completed",
  transcript: [],
  tools: [],
  revision: 1,
});
const tool = (
  id: string,
  actions: unknown[],
  status: ToolRun["status"] = "completed",
): ToolRun => ({
  id,
  name: "submit_book",
  input: {},
  output: { record: { actions } },
  status,
  startedAt: "2026-09-19T08:01:00Z",
});
const now = new Date("2026-09-19T12:00:00Z");
const book = {
  action: "BOOK",
  patient_id: "private-patient",
  provider_id: "PR10",
  slot: "2026-09-21T09:30:00+02:00",
};

test("SQLite persists metrics across runs and deduplicates cumulative receipts, retries and reordered keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lucia-metrics-"));
  const path = join(directory, "metrics.sqlite");
  let store = new MetricsStore(path);
  try {
    store.recordCall(call("one"));
    store.recordCall(call("one"));
    store.recordTool("one", tool("a", [book]));
    store.recordTool("one", tool("a", [book]));
    store.recordTool(
      "one",
      tool("b", [
        {
          slot: book.slot,
          provider_id: "PR10",
          patient_id: "private-patient",
          action: "BOOK",
        },
        { action: "ESCALATE", reason: "out_of_scope" },
      ]),
    );
    store.recordTool(
      "one",
      tool("c", [{ action: "ESCALATE", reason: "medical_emergency" }]),
    );
    store.close();
    store = new MetricsStore(path);
    const totals = store.overview("all", now).totals;
    assert.equal(totals.calls, 1);
    assert.equal(totals.bookings, 1);
    assert.equal(
      totals.forwarded,
      1,
      "count forwarded calls, not escalation actions",
    );
    assert.equal(totals.tools, 3);
    assert.equal(totals.averageDurationMs, 120000);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const db = new DatabaseSync(path, { readOnly: true });
    const saved = JSON.stringify([
      db.prepare("SELECT * FROM metric_calls").all(),
      db.prepare("SELECT * FROM metric_actions").all(),
    ]);
    assert.ok(
      !saved.includes("Private name") &&
        !saved.includes("private-patient") &&
        !saved.includes("private phone"),
    );
    db.close();
  } finally {
    store.close();
    await rm(directory, { recursive: true });
  }
});

test("only successful recorded actions count; empty output and failed requests do not", () => {
  const store = new MetricsStore();
  try {
    store.recordCall(call("one"));
    store.recordTool("one", tool("failed", [book], "failed"));
    store.recordTool("one", {
      ...tool("request", []),
      input: book,
      output: "not JSON",
    });
    store.recordTool("one", tool("running", [book], "running"));
    store.recordTool(
      "one",
      tool("done", [
        book,
        { action: "CANCEL", appointment_id: "a" },
        { action: "RESCHEDULE", appointment_id: "b" },
        { action: "REGISTER", new_patient: { given_name: "Private" } },
        { action: "NO_ACTION", reason: "no_availability" },
      ]),
    );
    const totals = store.overview("today", now).totals;
    assert.equal(totals.bookings, 1);
    assert.equal(totals.cancellations, 1);
    assert.equal(totals.reschedules, 1);
    assert.equal(totals.registrations, 1);
    assert.equal(totals.noAction, 1);
    assert.equal(totals.toolErrors, 1);
  } finally {
    store.close();
  }
});

test("Madrid date filters, zero-filled daily series and empty overview are consistent", () => {
  const store = new MetricsStore();
  try {
    assert.equal(store.overview("7d", now).daily.length, 7);
    assert.equal(store.overview("today", now).totals.calls, 0);
    store.recordCall(call("today", "2026-09-18T23:30:00Z"));
    store.recordCall(call("boundary", "2026-09-13T08:00:00Z"));
    store.recordCall(call("outside", "2026-09-12T08:00:00Z"));
    assert.equal(store.overview("today", now).totals.calls, 1);
    assert.equal(store.overview("7d", now).totals.calls, 2);
    assert.equal(store.overview("all", now).totals.calls, 3);
    assert.equal(store.overview("7d", now).daily.at(-1)?.calls, 1);
  } finally {
    store.close();
  }
});

test("metrics survive the 200-call and 400-tool UI retention limits", () => {
  const store = new CallStore();
  try {
    for (let i = 0; i < 205; i++) {
      store.start(String(i));
      store.finish(String(i));
    }
    assert.equal(store.list().length, 200);
    assert.equal(store.metrics.overview("all").totals.calls, 205);
    store.start("with-tools");
    store.toolStart("with-tools", "booking", "submit_book", {});
    store.toolEnd(
      "with-tools",
      "booking",
      JSON.stringify({ record: { actions: [book] } }),
    );
    for (let i = 0; i < 401; i++)
      store.toolStart("with-tools", String(i), "search_directory", {});
    assert.equal(store.get("with-tools")?.tools.length, 400);
    assert.equal(store.metrics.overview("all").totals.bookings, 1);
  } finally {
    store.metrics.close();
  }
});

test("legacy history backfill is idempotent and stale running state recovers on restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lucia-backfill-"));
  const path = join(directory, "metrics.sqlite");
  const history = join(directory, "calls.json");
  let metrics = new MetricsStore(path);
  try {
    const previous = call("legacy");
    previous.tools = [tool("one", [book])];
    await writeFile(history, JSON.stringify([previous]));
    await new CallStore(history, metrics).load();
    await new CallStore(history, metrics).load();
    assert.equal(metrics.overview("all", now).totals.bookings, 1);
    const active = call("active");
    delete active.endedAt;
    active.status = "active";
    metrics.recordCall(active);
    metrics.recordTool("active", tool("running", [], "running"));
    metrics.close();
    metrics = new MetricsStore(path);
    assert.equal(metrics.overview("all", now).totals.active, 0);
    assert.equal(metrics.overview("all", now).totals.interrupted, 1);
  } finally {
    metrics.close();
    await rm(directory, { recursive: true });
  }
});

test("full receipts are counted before display payload truncation", () => {
  const store = new CallStore();
  try {
    store.start("one");
    store.toolStart("one", "t", "submit_book", {});
    store.toolEnd(
      "one",
      "t",
      JSON.stringify({
        padding: "x".repeat(13000),
        record: { actions: [book] },
      }),
    );
    assert.equal(typeof store.get("one")?.tools[0]?.output, "string");
    assert.equal(store.metrics.overview("all").totals.bookings, 1);
  } finally {
    store.metrics.close();
  }
});
