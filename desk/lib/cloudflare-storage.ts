import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

export function usesCloudflareStorage() {
  return process.env.DESK_STORAGE === "d1";
}

export function database() {
  const db = getCloudflareContext().env.prosper_desk;
  if (!db) throw new Error("Missing Cloudflare D1 binding: prosper_desk");
  return db;
}

export async function readSetting<T>(key: string): Promise<T | null> {
  const row = await database()
    .prepare("SELECT value FROM desk_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row ? JSON.parse(row.value) as T : null;
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  await database()
    .prepare(`INSERT INTO desk_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    .bind(key, JSON.stringify(value))
    .run();
}

export async function appendEvent(
  kind: "lead" | "elevenlabs-postcall",
  value: unknown,
): Promise<void> {
  // One row per event avoids lost updates when requests arrive concurrently.
  await database()
    .prepare("INSERT INTO desk_events (id, kind, value) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), kind, JSON.stringify(value))
    .run();
}
