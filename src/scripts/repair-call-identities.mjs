import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { buildImport, readSources } from "./import-call-logs.mjs";
import { eventIdentity, spokenIdentity, summaryIdentity } from "../agent/caller-identity.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const quote = value => value == null ? "NULL" : `'${String(value).replaceAll("'", "''").replaceAll("\0", "")}'`;

/** Read-only plan, scoped by both organization and call ID. Existing names win. */
export function buildRepair(rows, turns, events, importedCalls = []) {
  const identities = new Map();
  const key = (org, id) => JSON.stringify([org, id]);
  const previous = new Map();
  for (const turn of [...turns].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    const id = key(turn.org_slug, turn.call_id);
    if (turn.speaker === "agent") previous.set(id, turn.text);
    else {
      const identity = spokenIdentity(turn.text, previous.get(id));
      if (identity) identities.set(id, identity);
    }
  }
  for (const call of importedCalls) {
    const identity = summaryIdentity(call.summary);
    if (identity) identities.set(key(call.org, call.id), identity);
  }
  for (const event of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    const payload = JSON.parse(event.payload);
    const identity = eventIdentity(event.type, payload);
    if (identity && payload.orgSlug) identities.set(key(payload.orgSlug, event.call_id), identity);
  }
  return rows.flatMap(row => {
    if (summaryIdentity(JSON.parse(row.summary ?? "{}"))) return [];
    const identity = identities.get(key(row.org_slug, row.call_id));
    return identity ? [{ ...row, identity }] : [];
  });
}

export function repairSql(plan) {
  return plan.map(row => `UPDATE voice_calls SET summary = json_patch(COALESCE(summary, '{}'), ${quote(JSON.stringify(row.identity))}) WHERE call_id = ${quote(row.call_id)} AND org_slug = ${quote(row.org_slug)} AND summary IS ${quote(row.summary)};`).join("\n") + "\n";
}

async function main() {
  const { values } = parseArgs({ options: {
    remote: { type: "boolean" }, local: { type: "boolean" }, apply: { type: "boolean" },
    logs: { type: "string", default: join(ROOT, "logs") }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: npm run calls:repair -- --remote|--local [--apply] [--logs DIR]\nDefaults to a read-only plan. Apply saves a private snapshot and patches missing identities only.");
    return;
  }
  if (Boolean(values.remote) === Boolean(values.local)) throw new Error("Choose exactly one of --remote or --local.");
  const execute = args => {
    const result = spawnSync(process.execPath, [join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
      "d1", "execute", "prosper_desk", "--config", join(ROOT, "desk/wrangler.jsonc"),
      values.remote ? "--remote" : "--local", "--json", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`D1 command failed: ${result.stderr}`);
    // File imports can print progress before the JSON result, even with --json.
    const start = result.stdout.search(/^\s*\[/m);
    const data = JSON.parse(start >= 0 ? result.stdout.slice(start).trim() : result.stdout);
    if (data.some(item => item.success === false)) throw new Error("D1 command was unsuccessful.");
    return data;
  };
  const snapshot = execute(["--command", `SELECT call_id, org_slug, started_at, ended_at, summary FROM voice_calls;
    SELECT call_id, org_slug, speaker, text, occurred_at FROM voice_transcript_entries ORDER BY occurred_at;
    SELECT call_id, type, occurred_at, payload FROM agent_events
    WHERE type IN ('tool.completed', 'patient.identified', 'crm.lookup.completed', 'call.ended') ORDER BY occurred_at;`]);
  const imported = buildImport(await readSources(resolve(values.logs)));
  const plan = buildRepair(...snapshot.map(item => item.results), imported.calls);
  console.log(JSON.stringify({ database: "prosper-desk", target: values.remote ? "remote" : "local",
    mode: values.apply ? "apply" : "dry-run", calls: snapshot[0].results.length, recoverable: plan.length,
    directoryIdentified: plan.filter(row => row.identity.patientId).length }, null, 2));
  if (!values.apply || !plan.length) return;
  const directory = await mkdtemp(join(tmpdir(), "prosper-call-identity-repair-"));
  await writeFile(join(directory, "before.json"), JSON.stringify(snapshot), { mode: 0o600 });
  const file = join(directory, "repair.sql");
  await writeFile(file, repairSql(plan), { mode: 0o600 });
  console.log(`Recovery snapshot: ${join(directory, "before.json")}`);
  const result = execute(["--file", file, "--yes"]);
  const verified = execute(["--command", "SELECT call_id, org_slug, summary FROM voice_calls"])[0].results;
  const repaired = plan.filter(row => verified.some(current => current.call_id === row.call_id &&
    current.org_slug === row.org_slug && JSON.parse(current.summary ?? "{}").patientName === row.identity.patientName)).length;
  console.log(JSON.stringify({ verified: repaired, planned: plan.length, success: result.every(item => item.success) }));
  if (repaired !== plan.length) throw new Error("Some calls changed during repair. Rerun the read-only plan to review them.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
