import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { auditPayload } from "../worker/audit.ts";

import { buildImport, readSources } from "../agent/log-records.mjs";
export { buildImport, readSources, timestamp, substantive } from "../agent/log-records.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const IMPORT_SOURCE = "local-logs-v1";
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''").replaceAll("\0", "")}'`;

export function importSql(plan) {
  const statements = [
    "-- Requires desk migrations 0002, 0003 and 0004. No schema changes are applied here.",
    "SELECT call_id, org_slug, started_at, ended_at, summary FROM voice_calls LIMIT 0;",
    "SELECT event_id, schema_version, call_id, config_version, type, occurred_at, payload FROM agent_events LIMIT 0;",
    "SELECT event_id, call_id, org_slug, occurred_at, sequence, speaker, text FROM voice_transcript_entries LIMIT 0;",
  ];
  for (const call of plan.calls) {
    // Existing live call records are authoritative. Imported records can be safely rerun.
    const owned = `EXISTS (SELECT 1 FROM voice_calls WHERE call_id = ${sql(call.id)} AND org_slug = ${sql(call.org)} AND json_extract(summary, '$.importSource') = ${sql(IMPORT_SOURCE)})`;
    statements.push(`INSERT INTO voice_calls (call_id, org_slug, started_at, ended_at, summary) VALUES (${[call.id, call.org, call.startedAt, call.endedAt, JSON.stringify(call.summary)].map(sql).join(", ")}) ON CONFLICT(call_id) DO NOTHING;`);
    if (call.summary.patientName) {
      const identity = Object.fromEntries(["patientName", "patientId", "insurer"].filter(key => call.summary[key]).map(key => [key, call.summary[key]]));
      statements.push(`UPDATE voice_calls SET summary = json_patch(COALESCE(summary, '{}'), ${sql(JSON.stringify(identity))}) WHERE ${owned} AND NULLIF(json_extract(summary, '$.patientName'), '') IS NULL;`);
    }
    call.turns.forEach((turn, index) => {
      statements.push(`INSERT INTO voice_transcript_entries (event_id, call_id, org_slug, occurred_at, sequence, speaker, text) SELECT ${[turn.id, call.id, call.org, turn.at, index + 1, turn.speaker, turn.text].map(sql).join(", ")} WHERE ${owned} ON CONFLICT(event_id) DO NOTHING;`);
    });
    for (const event of call.events) {
      const payload = auditPayload({ ...event.payload, orgSlug: call.org, zeroRetention: true }, true);
      statements.push(`INSERT INTO agent_events (event_id, schema_version, call_id, config_version, type, occurred_at, payload) SELECT ${[event.eventId, 1, call.id, event.configVersion ?? "log-import", event.type, event.occurredAt, JSON.stringify(payload)].map(sql).join(", ")} WHERE ${owned} ON CONFLICT(event_id) DO NOTHING;`);
    }
  }
  return `${statements.join("\n")}\n`;
}

/** Backfill only tool events for calls already in this database. */
export function toolEventsSql(plan) {
  const statements = [];
  for (const call of plan.calls) {
    const existing = `EXISTS (SELECT 1 FROM voice_calls WHERE call_id = ${sql(call.id)} AND org_slug = ${sql(call.org)})`;
    for (const event of call.events.filter(event => /^tool\.(called|received|completed|failed|blocked)$/.test(event.type))) {
      const payload = auditPayload({ ...event.payload, orgSlug: call.org, zeroRetention: true }, true);
      statements.push(`INSERT INTO agent_events (event_id, schema_version, call_id, config_version, type, occurred_at, payload) SELECT ${[event.eventId, 1, call.id, event.configVersion ?? "log-import", event.type, event.occurredAt, JSON.stringify(payload)].map(sql).join(", ")} WHERE ${existing} ON CONFLICT(event_id) DO UPDATE SET payload = json_patch(excluded.payload, agent_events.payload) WHERE agent_events.call_id = excluded.call_id AND json_extract(agent_events.payload, '$.orgSlug') = ${sql(call.org)};`);
    }
  }
  return statements.join("\n") + "\n";
}


async function main() {
  const { values } = parseArgs({ options: {
    logs: { type: "string", default: join(ROOT, "logs") }, org: { type: "string" },
    "tools-only": { type: "boolean" },
    report: { type: "string" }, out: { type: "string" }, apply: { type: "boolean" }, remote: { type: "boolean" },
    local: { type: "boolean" }, "dry-run": { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: npm run calls:import -- [--logs DIR] [--org arenal] [--out FILE.sql] [--report FILE.json]\nDefault: dry-run counts only. Write to D1 with --apply --remote (or --apply --local).\nUse --tools-only to recover tool events on existing calls without importing call records or transcripts.\nUses prosper_desk in desk/wrangler.jsonc. Requires migrations 0002–0004.");
    return;
  }
  if (values.remote && values.local) throw new Error("Choose --remote or --local, not both.");
  if (values.apply && (!values.remote && !values.local || values["dry-run"])) {
    throw new Error("--apply requires exactly one of --remote/--local and cannot be combined with --dry-run.");
  }
  const plan = buildImport(await readSources(resolve(values.logs)), { org: values.org });
  console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", database: "prosper-desk",
    target: values.remote ? "remote" : values.local ? "local" : "none", ...plan.stats }, null, 2));
  if (!plan.calls.length) throw new Error("No usable calls found; nothing was written.");
  const statements = values["tools-only"] ? toolEventsSql(plan) : importSql(plan);
  if (values.report) await writeFile(resolve(values.report), JSON.stringify(plan.decisions, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (values.out) {
    await writeFile(resolve(values.out), statements, { flag: "wx", mode: 0o600 });
    console.log(`SQL written to ${resolve(values.out)}`);
  }
  if (!values.apply) return;
  const directory = await mkdtemp(join(tmpdir(), "prosper-call-import-"));
  try {
    const file = join(directory, "calls.sql");
    await writeFile(file, statements, { mode: 0o600 });
    const result = spawnSync(process.execPath, [join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
      "d1", "execute", "prosper_desk", "--config", join(ROOT, "desk/wrangler.jsonc"),
      values.remote ? "--remote" : "--local", "--file", file, "--yes"], { cwd: ROOT, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`D1 import failed (${result.status ?? result.signal}); rerunning is safe.`);
    console.log(values["tools-only"] ? "Tool-event recovery finished. Call records and transcripts were left unchanged." : "Import finished. Existing live records were left unchanged.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
