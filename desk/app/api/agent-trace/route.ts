import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { database, usesCloudflareStorage } from "@/lib/cloudflare-storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if ((await getSession())?.kind !== "hash") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (!usesCloudflareStorage()) {
    return NextResponse.json({ error: "La auditoría D1 requiere el entorno Cloudflare" }, { status: 501 });
  }
  const url = new URL(request.url);
  const callId = url.searchParams.get("callId")?.trim();
  const after = Number(url.searchParams.get("after") ?? "0");
  if (!callId || callId.length > 128 || !Number.isSafeInteger(after) || after < 0) {
    return NextResponse.json({ error: "callId y cursor no válidos" }, { status: 400 });
  }
  const rows = await database().prepare(`SELECT rowid AS cursor, event_id, schema_version,
    call_id, config_version, type, occurred_at, payload FROM agent_events
    WHERE call_id = ? AND rowid > ? ORDER BY rowid LIMIT 201`)
    .bind(callId, after)
    .all<{ cursor: number; event_id: string; schema_version: number; call_id: string;
      config_version: string; type: string; occurred_at: string; payload: string }>();
  const page = rows.results.slice(0, 200);
  return NextResponse.json({
    events: page.map((row) => ({ ...row, payload: JSON.parse(row.payload) })),
    nextCursor: rows.results.length > 200 ? page.at(-1)!.cursor : null,
  }, { headers: { "cache-control": "private, no-store" } });
}
