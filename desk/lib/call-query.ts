import { callFromRow } from "./call-records";
import { enrichCalls } from "./call-enrichment";

type CallDatabase = { prepare(sql: string): { bind(...values: unknown[]): {
  all<T>(): Promise<{ results: T[] }>;
} } };

export async function readStoredCalls(db: CallDatabase, org: string, range?: { from: string; to: string }) {
  // The overview reads the complete date range; the historical list is explicitly bounded.
  const result = await db.prepare(`SELECT c.call_id, c.started_at, c.summary,
    EXISTS (SELECT 1 FROM agent_events e WHERE e.call_id = c.call_id
      AND json_extract(e.payload, '$.orgSlug') = c.org_slug
      AND (json_extract(e.payload, '$.source') = 'simulator'
        OR json_extract(e.payload, '$.origin') = 'simulator'
        OR json_extract(e.payload, '$.demo') = 1
        OR json_extract(e.payload, '$.simulation') = 1)) AS simulator
    FROM voice_calls c WHERE c.org_slug = ?
    ${range ? "AND c.started_at >= ? AND c.started_at < ?" : ""}
    ORDER BY c.started_at DESC, c.call_id DESC ${range ? "" : "LIMIT 500"}`)
    .bind(org, ...(range ? [range.from, range.to] : []))
    .all<{ call_id: string; started_at: string; summary: string | null; simulator: number }>();
  const calls = result.results.map(callFromRow);
  if (!calls.length) return calls;
  const turns = await db.prepare(`SELECT t.call_id, t.speaker, t.text
    FROM voice_transcript_entries t
    WHERE t.org_slug = ? AND t.call_id IN (
      SELECT c.call_id FROM voice_calls c WHERE c.org_slug = ?
      ${range ? "AND c.started_at >= ? AND c.started_at < ?" : ""}
      ORDER BY c.started_at DESC, c.call_id DESC ${range ? "" : "LIMIT 500"})
    ORDER BY t.sequence, t.occurred_at, t.event_id`)
    .bind(org, org, ...(range ? [range.from, range.to] : []))
    .all<{ call_id: string; speaker: string; text: string }>();
  return enrichCalls(calls, turns.results);
}

export async function listStoredOrgSlugs(db: CallDatabase): Promise<string[]> {
  const result = await db.prepare("SELECT DISTINCT org_slug FROM voice_calls ORDER BY org_slug")
    .bind()
    .all<{ org_slug: string }>();
  return result.results.map((row) => row.org_slug);
}

export async function countOpenCalls(db: CallDatabase): Promise<number> {
  const result = await db.prepare(
    `SELECT count(*) AS n FROM voice_calls WHERE json_extract(summary, '$.outcome') = 'en_curso'`,
  ).bind().all<{ n: number }>();
  return Number(result.results[0]?.n) || 0;
}
