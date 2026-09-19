import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, closeSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Call, ToolRun } from "./calls.ts";

export type MetricPeriod = "today" | "7d" | "30d" | "all";
const madridDay = (value: string | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const kinds = new Set([
  "BOOK",
  "CANCEL",
  "RESCHEDULE",
  "REGISTER",
  "NO_ACTION",
  "ESCALATE",
]);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Permanent, non-transcript metrics, independent of the recent-history limit. */
export class MetricsStore {
  private db: DatabaseSync;
  storageError = false;
  readonly persistent: boolean;

  constructor(file?: string) {
    this.persistent = Boolean(file);
    if (file) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      // Create privately before SQLite opens it; WAL sidecars inherit this mode.
      closeSync(openSync(file, "a", 0o600));
      chmodSync(file, 0o600);
    }
    this.db = new DatabaseSync(file ?? ":memory:");
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS metric_calls (
        id TEXT PRIMARY KEY, started_at TEXT NOT NULL, day TEXT NOT NULL,
        status TEXT NOT NULL, connected INTEGER NOT NULL,
        ended_at TEXT, duration_ms INTEGER, last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS metric_calls_day ON metric_calls(day);
      CREATE TABLE IF NOT EXISTS metric_tools (
        call_id TEXT NOT NULL REFERENCES metric_calls(id), id TEXT NOT NULL,
        name TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(call_id, id)
      );
      CREATE TABLE IF NOT EXISTS metric_actions (
        call_id TEXT NOT NULL REFERENCES metric_calls(id), fingerprint TEXT NOT NULL,
        kind TEXT NOT NULL, PRIMARY KEY(call_id, fingerprint)
      );
      UPDATE metric_calls SET status='interrupted', ended_at=last_seen_at,
        duration_ms=MAX(0, CAST((julianday(last_seen_at)-julianday(started_at))*86400000 AS INTEGER))
        WHERE status='active';
      UPDATE metric_tools SET status='interrupted' WHERE status='running';
    `);
  }

  private write(operation: () => void): void {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      operation();
      this.db.exec("COMMIT");
    } catch {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* No transaction began. */
      }
      // Latch the error: a later successful write cannot restore a lost event.
      this.storageError = true;
    }
  }

  recordCall(call: Call): void {
    this.write(() => {
      this.db
        .prepare(
          `INSERT INTO metric_calls(id, started_at, day, status, connected, ended_at, duration_ms, last_seen_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, connected=excluded.connected, ended_at=excluded.ended_at,
        duration_ms=excluded.duration_ms, last_seen_at=excluded.last_seen_at`,
        )
        .run(
          call.id,
          call.startedAt,
          madridDay(call.startedAt),
          call.status,
          Number(call.connected),
          call.endedAt ?? null,
          call.endedAt
            ? Math.max(0, Date.parse(call.endedAt) - Date.parse(call.startedAt))
            : null,
          call.endedAt ?? new Date().toISOString(),
        );
    });
  }

  recordTool(
    callId: string,
    tool: ToolRun,
    result: unknown = tool.output,
  ): void {
    this.write(() => {
      this.db
        .prepare(
          `INSERT INTO metric_tools(call_id,id,name,status) VALUES(?,?,?,?)
        ON CONFLICT(call_id,id) DO UPDATE SET status=excluded.status`,
        )
        .run(callId, tool.id, tool.name, tool.status);
      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch {
          return;
        }
      }
      if (
        tool.status !== "completed" ||
        !tool.name.startsWith("submit_") ||
        !object(result) ||
        result.error ||
        !object(result.record) ||
        !Array.isArray(result.record.actions)
      )
        return;
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO metric_actions(call_id,fingerprint,kind) VALUES(?,?,?)",
      );
      for (const action of result.record.actions) {
        if (
          !object(action) ||
          typeof action.action !== "string" ||
          !kinds.has(action.action)
        )
          continue;
        // A receipt may repeat previous actions. Store each distinct recorded action
        // once per call, independent of key order, tool retries or receipt timestamp.
        const fingerprint = createHash("sha256")
          .update(canonical(action))
          .digest("hex");
        insert.run(callId, fingerprint, action.action);
      }
    });
  }

  overview(period: MetricPeriod = "30d", now = new Date()) {
    if (this.storageError) throw new Error("Metrics storage is incomplete");
    const today = madridDay(now);
    const from =
      period === "all"
        ? "0000-01-01"
        : shiftDay(today, period === "today" ? 0 : period === "7d" ? -6 : -29);
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS calls,
      COALESCE(SUM(connected),0) AS answered,
      COALESCE(SUM(status='active'),0) AS active,
      COALESCE(SUM(status='completed'),0) AS completed,
      COALESCE(SUM(status='missed'),0) AS missed,
      COALESCE(SUM(status='failed'),0) AS failed,
      COALESCE(SUM(status='interrupted'),0) AS interrupted,
      COALESCE(SUM(connected=1 AND ended_at IS NOT NULL),0) AS durationSamples,
      COALESCE(ROUND(AVG(CASE WHEN connected=1 AND ended_at IS NOT NULL THEN duration_ms END)),0) AS averageDurationMs,
      COALESCE(SUM(EXISTS(SELECT 1 FROM metric_actions a WHERE a.call_id=metric_calls.id AND a.kind='ESCALATE')),0) AS forwarded
      FROM metric_calls WHERE day BETWEEN ? AND ?`,
      )
      .get(from, today) as Record<
      | "calls"
      | "answered"
      | "active"
      | "completed"
      | "missed"
      | "failed"
      | "interrupted"
      | "averageDurationMs"
      | "durationSamples"
      | "forwarded",
      number
    >;
    const actions = Object.fromEntries(
      this.db
        .prepare(
          `SELECT a.kind, COUNT(*) AS total FROM metric_actions a
      JOIN metric_calls c ON c.id=a.call_id WHERE c.day BETWEEN ? AND ? GROUP BY a.kind`,
        )
        .all(from, today)
        .map((row) => [String(row.kind), Number(row.total)]),
    );
    const toolTotals = this.db
      .prepare(
        `SELECT COUNT(*) AS tools, COALESCE(SUM(t.status='failed'),0) AS toolErrors
      FROM metric_tools t JOIN metric_calls c ON c.id=t.call_id WHERE c.day BETWEEN ? AND ?`,
      )
      .get(from, today) as { tools: number; toolErrors: number };
    const chartFrom = period === "all" ? shiftDay(today, -29) : from;
    const rows = this.db
      .prepare(
        `SELECT day, COUNT(*) AS calls,
      SUM(EXISTS(SELECT 1 FROM metric_actions a WHERE a.call_id=c.id AND a.kind='ESCALATE')) AS forwarded,
      SUM((SELECT COUNT(*) FROM metric_actions a WHERE a.call_id=c.id AND a.kind='BOOK')) AS bookings
      FROM metric_calls c WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`,
      )
      .all(chartFrom, today);
    const days = new Map(rows.map((row) => [String(row.day), row]));
    const daily = [];
    for (let day = chartFrom; day <= today; day = shiftDay(day, 1)) {
      const row = days.get(day);
      daily.push({
        day,
        calls: Number(row?.calls ?? 0),
        forwarded: Number(row?.forwarded ?? 0),
        bookings: Number(row?.bookings ?? 0),
      });
    }
    const first = this.db
      .prepare("SELECT MIN(day) AS day FROM metric_calls")
      .get();
    return {
      period,
      from: period === "all" ? (first?.day ?? today) : from,
      to: today,
      generatedAt: now.toISOString(),
      persistent: this.persistent,
      totals: {
        ...totals,
        ...toolTotals,
        bookings: actions.BOOK ?? 0,
        cancellations: actions.CANCEL ?? 0,
        reschedules: actions.RESCHEDULE ?? 0,
        registrations: actions.REGISTER ?? 0,
        noAction: actions.NO_ACTION ?? 0,
      },
      daily,
    };
  }

  close(): void {
    this.db.close();
  }
}
