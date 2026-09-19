import type { CallEvent } from "../agent/call-event.ts";
import { mergeRuntimeConfig } from "../agent/runtime-config.ts";
import { auditPayload } from "./audit.ts";

export async function readRuntimeConfig(db: D1Database, orgSlug: string) {
  const rows = await db.prepare("SELECT key, value FROM desk_settings WHERE key IN (?, ?)")
    .bind("agent-config", `org-agent-config:${orgSlug}`).all<{ key: string; value: string }>();
  const settings = Object.fromEntries(rows.results.map((row) => [row.key, JSON.parse(row.value)]));
  return mergeRuntimeConfig(settings["agent-config"] ?? {}, settings[`org-agent-config:${orgSlug}`] ?? {});
}

export async function storeCallEvent(db: D1Database, event: CallEvent): Promise<void> {
  // The call record retains the conversation even when diagnostic PII is redacted.
  // Persist each turn, not the handoff context's rolling twelve-message window.
  if ((event.type === "conversation.user" || event.type === "conversation.agent") &&
      typeof event.payload.text === "string" && event.payload.text.trim()) {
    await db.prepare(`INSERT INTO voice_transcript_entries
      (event_id, call_id, org_slug, occurred_at, sequence, speaker, text)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING`)
      .bind(event.eventId, event.callId, String(event.payload.orgSlug ?? "arenal"),
        event.occurredAt, Number(event.payload.sequence ?? 0),
        event.type === "conversation.user" ? "caller" : "agent", event.payload.text).run();
  }
  const payload = auditPayload(event.payload, event.payload.zeroRetention !== false);
  await db.prepare(`INSERT INTO agent_events
    (event_id, schema_version, call_id, config_version, type, occurred_at, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING`)
    .bind(event.eventId, event.schemaVersion, event.callId, event.configVersion,
      event.type, event.occurredAt, JSON.stringify(payload)).run();
  if (event.type === "call.started") {
    await db.prepare(`INSERT INTO voice_calls (call_id, org_slug, started_at)
      VALUES (?, ?, ?) ON CONFLICT(call_id) DO NOTHING`)
      .bind(event.callId, String(event.payload.orgSlug ?? "arenal"), event.occurredAt).run();
  }
  if (event.type === "call.ended") {
    await db.prepare(`INSERT INTO voice_calls (call_id, org_slug, started_at, ended_at, summary)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(call_id) DO UPDATE SET
      ended_at = excluded.ended_at, summary = excluded.summary`)
      .bind(event.callId, String(event.payload.orgSlug ?? "arenal"),
        new Date(Date.parse(event.occurredAt) - Number(event.payload.durationMs ?? 0)).toISOString(),
        event.occurredAt, JSON.stringify(event.payload)).run();
  }
}
