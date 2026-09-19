import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoggedCall } from "./types";
import { database, usesCloudflareStorage } from "./cloudflare-storage";
import { callFromRow } from "./call-records";

export async function readLiveCalls(orgSlug?: string): Promise<LoggedCall[]> {
  if (usesCloudflareStorage()) {
    const result = await database().prepare(`SELECT call_id, started_at, summary FROM voice_calls
      WHERE (? IS NULL OR org_slug = ?) ORDER BY started_at DESC LIMIT 500`)
      .bind(orgSlug ?? null, orgSlug ?? null)
      .all<{ call_id: string; started_at: string; summary: string | null }>();
    return result.results.map(callFromRow);
  }
  try {
    const parsed = JSON.parse(
      await readFile(path.resolve(process.cwd(), "lib", "from-logs.json"), "utf8"),
    ) as { calls?: LoggedCall[] };
    return (parsed.calls ?? []).sort((a, b) =>
      String(b.started ?? "").localeCompare(String(a.started ?? "")),
    );
  } catch {
    return [];
  }
}
