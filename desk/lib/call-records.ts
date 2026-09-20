import type { CallDetail, LoggedCall, TranscriptEntry } from "./types";
import { actionsFromEvents } from "./call-tools";
import { dedupeTurns } from "./transcript";

type CallRow = { call_id: string; started_at: string; summary: string | null; simulator?: number };
type CallDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
};

export const TRANSCRIPT_PAGE_SIZE = 100;

export function callFromRow(row: CallRow): LoggedCall {
  const summary = row.summary ? JSON.parse(row.summary) : {};
  const outcome = String(summary.outcome ?? "en_curso");
  return {
    id: row.call_id, started: row.started_at, minutes: typeof summary.durationMs === "number" && Number.isFinite(summary.durationMs) && summary.durationMs >= 0 && !summary.importIncomplete ? summary.durationMs / 60_000 : null,
    origin: row.simulator || summary.demo || summary.simulation || summary.origin === "simulator" ? "simulator" : "phone",
    phone: null, patient: summary.patientName || null, patientId: summary.patientId || null, insurer: summary.insurer || null,
    site: summary.site ?? null, siteName: summary.site ?? "Sin sede",
    outcome, reason: summary.reason ?? null, motive: summary.motive ?? summary.intent ?? "",
    slot: null, providerId: null, source: "llamadas", sourceFile: null,
    resolution: outcome === "escalado" ? "escalated"
      : ["cita", "alta", "sin_cita", "cancelacion", "cambio"].includes(outcome) ? "resolved" : "unknown",
    route: summary.route ?? null, intent: summary.intent ?? null,
    toolCalls: summary.toolCalls, toolErrors: summary.toolErrors,
    frustrationScore: summary.frustrationScore, configVersion: summary.configVersion ?? null,
  };
}

/** Read a single call directly, including calls older than the list's 500-row window. */
export async function readCallRecord(
  db: CallDatabase, orgSlug: string, callId: string, requestedPage = 1,
): Promise<CallDetail | null> {
  const row = await db.prepare(`SELECT c.call_id, c.started_at, c.summary,
    EXISTS (SELECT 1 FROM agent_events e WHERE e.call_id = c.call_id
      AND json_extract(e.payload, '$.orgSlug') = c.org_slug
      AND (json_extract(e.payload, '$.source') = 'simulator'
        OR json_extract(e.payload, '$.origin') = 'simulator'
        OR json_extract(e.payload, '$.demo') = 1
        OR json_extract(e.payload, '$.simulation') = 1)) AS simulator
    FROM voice_calls c WHERE c.org_slug = ? AND c.call_id = ?`).bind(orgSlug, callId).first<CallRow>();
  if (!row) return null;

  const entries = await db.prepare(`SELECT event_id AS id, occurred_at AS at, speaker, text
    FROM voice_transcript_entries WHERE org_slug = ? AND call_id = ?
    ORDER BY sequence, occurred_at, event_id`)
    .bind(orgSlug, callId)
    .all<TranscriptEntry>();
  const transcript = dedupeTurns(entries.results);
  const total = transcript.length;
  const pages = Math.max(1, Math.ceil(total / TRANSCRIPT_PAGE_SIZE));
  const page = Math.min(pages, Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1);
  const tools = await db.prepare(`SELECT event_id, type, occurred_at, payload FROM agent_events
    WHERE call_id = ? AND json_extract(payload, '$.orgSlug') = ?
      AND type IN ('tool.received', 'tool.called', 'tool.completed', 'tool.failed', 'tool.blocked')
    ORDER BY occurred_at, rowid`).bind(callId, orgSlug)
    .all<{ event_id: string; type: string; occurred_at: string; payload: string }>();
  const call = { ...callFromRow(row), actions: actionsFromEvents(tools.results) };
  return {
    call,
    transcript: transcript.slice((page - 1) * TRANSCRIPT_PAGE_SIZE, page * TRANSCRIPT_PAGE_SIZE),
    transcriptTotal: total,
    page,
    pages,
  };
}
