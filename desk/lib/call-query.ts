import { callFromRow } from "./call-records";

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
  return result.results.map(callFromRow);
}
