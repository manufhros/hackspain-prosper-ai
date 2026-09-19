import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoggedCall } from "./types";
import { database, usesCloudflareStorage } from "./cloudflare-storage";

export async function readLiveCalls(orgSlug?: string): Promise<LoggedCall[]> {
  if (usesCloudflareStorage()) {
    const result = await database().prepare(`SELECT call_id, started_at, summary FROM voice_calls
      WHERE (? IS NULL OR org_slug = ?) ORDER BY started_at DESC LIMIT 500`)
      .bind(orgSlug ?? null, orgSlug ?? null)
      .all<{ call_id: string; started_at: string; summary: string | null }>();
    return result.results.map((row): LoggedCall => {
      const summary = row.summary ? JSON.parse(row.summary) : {};
      const outcome = String(summary.outcome ?? "en_curso");
      return {
        id: row.call_id, started: row.started_at, minutes: Number(summary.durationMs ?? 0) / 60_000,
        phone: null, patient: null, patientId: null, insurer: null,
        site: summary.site ?? null, siteName: summary.site ?? "Sin sede",
        outcome, reason: summary.reason ?? null, motive: summary.intent ?? "",
        slot: null, providerId: null, source: "llamadas", sourceFile: null,
        resolution: outcome === "en_curso" ? "unknown" : outcome === "sin_cierre" ? "abandoned"
          : outcome === "escalado" ? "escalated" : "resolved",
        route: summary.route ?? null, intent: summary.intent ?? null,
        toolCalls: summary.toolCalls ?? 0, toolErrors: summary.toolErrors ?? 0,
        frustrationScore: summary.frustrationScore ?? 0, configVersion: summary.configVersion ?? null,
      };
    });
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
