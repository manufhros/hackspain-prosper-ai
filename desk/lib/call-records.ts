import type { CallDetail, LoggedCall, TranscriptEntry } from "./types";
import { actionsFromEvents } from "./call-tools";

type CallRow = { call_id: string; started_at: string; summary: string | null };
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
    id: row.call_id, started: row.started_at, minutes: Number(summary.durationMs ?? 0) / 60_000,
    phone: null, patient: summary.patientName || null, patientId: summary.patientId || null, insurer: summary.insurer || null,
    site: summary.site ?? null, siteName: summary.site ?? "Sin sede",
    outcome, reason: summary.reason ?? null, motive: summary.intent ?? "",
    slot: null, providerId: null, source: "llamadas", sourceFile: null,
    resolution: outcome === "en_curso" ? "unknown" : outcome === "sin_cierre" ? "abandoned"
      : outcome === "escalado" ? "escalated" : "resolved",
    route: summary.route ?? null, intent: summary.intent ?? null,
    toolCalls: summary.toolCalls ?? 0, toolErrors: summary.toolErrors ?? 0,
    frustrationScore: summary.frustrationScore ?? 0, configVersion: summary.configVersion ?? null,
  };
}

/** Read a single call directly, including calls older than the list's 500-row window. */
export async function readCallRecord(
  db: CallDatabase, orgSlug: string, callId: string, requestedPage = 1,
): Promise<CallDetail | null> {
  const row = await db.prepare(`SELECT call_id, started_at, summary FROM voice_calls
    WHERE org_slug = ? AND call_id = ?`).bind(orgSlug, callId).first<CallRow>();
  if (!row) return null;

  const count = await db.prepare(`SELECT count(*) AS total FROM voice_transcript_entries
    WHERE org_slug = ? AND call_id = ?`).bind(orgSlug, callId).first<{ total: number }>();
  const total = count?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / TRANSCRIPT_PAGE_SIZE));
  const page = Math.min(pages, Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1);
  const entries = await db.prepare(`SELECT event_id AS id, occurred_at AS at, speaker, text
    FROM voice_transcript_entries WHERE org_slug = ? AND call_id = ?
    ORDER BY sequence, occurred_at, event_id LIMIT ? OFFSET ?`)
    .bind(orgSlug, callId, TRANSCRIPT_PAGE_SIZE, (page - 1) * TRANSCRIPT_PAGE_SIZE)
    .all<TranscriptEntry>();
  const tools = await db.prepare(`SELECT event_id, type, occurred_at, payload FROM agent_events
    WHERE call_id = ? AND json_extract(payload, '$.orgSlug') = ?
      AND type IN ('tool.received', 'tool.called', 'tool.completed', 'tool.failed', 'tool.blocked')
    ORDER BY occurred_at, rowid`).bind(callId, orgSlug)
    .all<{ event_id: string; type: string; occurred_at: string; payload: string }>();
  const call = { ...callFromRow(row), actions: actionsFromEvents(tools.results) };
  return { call, transcript: entries.results, transcriptTotal: total, page, pages };
}
