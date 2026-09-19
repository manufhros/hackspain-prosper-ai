import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { auditPayload } from "../worker/audit.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IMPORT_SOURCE = "local-logs-v1";
const OUTCOMES = { submit_book: "cita", submit_register: "alta", submit_cancel: "cancelacion",
  submit_reschedule: "cambio", submit_escalate: "escalado", submit_no_action: "sin_cita" };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const number = (value) => Number.isFinite(value) && value >= 0 ? value : 0;

export function timestamp(value) {
  const normalized = String(value).replace(",", ".").replace(/ CEST$/, "+02:00").replace(/ CET$/, "+01:00");
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(normalized)) throw new Error(`Timestamp needs a timezone: ${value}`);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new Error(`Invalid timestamp: ${value}`);
  return new Date(time).toISOString();
}

export function substantive(text) {
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const rest = normalized.replace(/\b(hello|hi|hey|hola|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|yes|yeah|si|okay|ok|gracias|thanks|thank you|um|uh|hmm|mhm|vale|por favor|please)\b/g, "").trim();
  if (/^(?:can you hear me|are you still there|is anyone there|me oyes|me escuchas|em sentiu|probando|testing|test|one two three|uno dos tres)[ ?]*$/.test(rest)) return false;
  return rest.split(/\s+/).filter(Boolean).length >= 3 || /\b(cita|appointment|cancelar|cancel|doctor|recepcion|emergencia|register|registrar|horario)\b/.test(rest);
}

function json(value) {
  try { const parsed = JSON.parse(value); return record(parsed) ? parsed : null; }
  catch { return null; } // Older text logs truncate some provider responses.
}

/** Parse sources in memory. No network, database, or filesystem mutations. */
export function buildImport(files, { org } = {}) {
  const exclusions = json(files.get("import-exclusions.json") ?? "{}") ?? {};
  const calls = new Map();
  const globalIds = new Set([...files].filter(([name]) => name.endsWith(".log"))
    .flatMap(([, text]) => [...text.matchAll(/\] call start (\S+)/g)].map((match) => match[1])));
  const stats = { files: files.size, ambiguousLines: 0, orphanLines: 0, incompleteCalls: 0, skippedCalls: 0 };
  const ensure = (id) => {
    if (!calls.has(id)) calls.set(id, { id, org: null, start: null, last: null, close: null,
      turns: new Map(), events: new Map(), sources: new Set(), toolCalls: 0, toolErrors: 0,
      outcome: "sin_cierre", reason: null, site: null });
    return calls.get(id);
  };
  const touch = (call, at, source) => {
    if (!call.start || at < call.start) call.start = at;
    if (!call.last || at > call.last) call.last = at;
    call.sources.add(source);
  };
  const setOrg = (call, value) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (call.org && call.org !== value) throw new Error(`Conflicting organizations for call ${call.id}`);
    call.org = value;
  };
  const addTurn = (call, at, speaker, text, eventId) => {
    if (typeof text !== "string" || !text.trim() || text === "[redacted]") return;
    const id = `log-turn-${hash(JSON.stringify([call.id, at, speaker, text]))}`;
    // A structured turn wins over the duplicate text-log turn.
    if (!call.turns.has(id) || eventId) call.turns.set(id, { id: eventId ?? id, at, speaker, text });
  };

  for (const [source, text] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!source.endsWith(".log")) continue;
    const lines = text.split(/\r?\n/).flatMap((line, index) => {
      const match = line.match(/^\[([^\]]+)\]\s+(.*)$/);
      return match ? [{ at: timestamp(match[1]), body: match[2], index }] : [];
    });
    // Prefer the local file; rotated logs may continue a globally unambiguous call.
    const ids = new Set();
    for (const { at, body } of lines) {
      const start = body.match(/^call start (\S+)/);
      if (start) { ids.add(start[1]); touch(ensure(start[1]), at, source); }
      const stream = body.match(/^stream start (\S+) (\{.*)$/);
      const params = stream && json(stream[2]);
      if (params && !params.join && !params.Join) {
        const id = params.call_id || stream[1];
        ids.add(id);
        setOrg(ensure(id), params.org_slug);
      }
    }
    for (const { at, body } of lines) {
      const tag = body.match(/^(?:(ERROR|WARN) )?(\S+) (.*)$/);
      if (!tag) continue;
      const [, level, prefix, message] = tag;
      if (!/^(?:user |agent |helper |patient reply |tool |elevenlabs closed|flushed book)/.test(message)) continue;
      let matches = ids.has(prefix) ? [prefix] : [...ids].filter((id) => id.slice(0, 8) === prefix);
      if (!matches.length) matches = [...globalIds].filter((id) => id === prefix || id.slice(0, 8) === prefix);
      if (matches.length !== 1) {
        stats[matches.length ? "ambiguousLines" : "orphanLines"]++;
        continue;
      }
      const call = ensure(matches[0]);
      touch(call, at, source);
      const turn = message.match(/^(user|agent|helper) (.+)$/);
      if (turn) {
        // The current dashboard has two roles. Label human reception explicitly.
        addTurn(call, at, turn[1] === "user" ? "caller" : "agent",
          turn[1] === "helper" ? `[Recepción humana] ${turn[2]}` : turn[2]);
      }
      if (message.startsWith("patient reply ") && message !== "patient reply on phone after pause") {
        addTurn(call, at, "caller", message.slice("patient reply ".length));
      }
      const tool = message.match(/^tool (\w+) (\{.*)$/);
      if (tool) {
        call.toolCalls++;
        const params = json(tool[2]);
        if (["centro", "norte", "sur"].includes(params?.location_id)) call.site = params.location_id;
      }
      if (level === "ERROR" && message.startsWith("tool error ")) call.toolErrors++;
      const result = message.match(/^tool result (submit_\w+) (\{.*)$/);
      const payload = result && json(result[2]);
      // Tool requests are not evidence of a successful action.
      const action = payload?.record?.actions?.find((item) => item.action === result[1].slice(7).toUpperCase());
      const received = payload?.call_id === call.id && typeof payload.received_at === "string" && action;
      if ((payload?.accepted === true || received) && !payload.error && !payload.held && OUTCOMES[result[1]] && (!call.outcomeAt || at >= call.outcomeAt)) {
        call.outcomeAt = at;
        call.outcome = OUTCOMES[result[1]];
        call.reason = typeof (action?.reason ?? payload.reason) === "string" ? (action?.reason ?? payload.reason) : null;
        if (["centro", "norte", "sur"].includes(action?.location_id)) call.site = action.location_id;
      }

      if (message.startsWith("elevenlabs closed") && (!call.close || at > call.close)) call.close = at;
    }
  }

  for (const [source, text] of files) {
    if (!source.endsWith(".jsonl")) continue;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const event = json(line);
      if (!event || typeof event.callId !== "string" || !event.callId ||
          typeof event.type !== "string" || !record(event.payload)) {
        throw new Error(`Invalid structured event at ${source}:${index + 1}`);
      }
      const at = timestamp(event.occurredAt);
      const call = ensure(event.callId);
      touch(call, at, source);
      setOrg(call, event.payload.orgSlug);
      const eventId = event.eventId || `log-event-${hash(line)}`;
      call.events.set(eventId, { ...event, eventId, occurredAt: at });
      if (event.type === "conversation.user" || event.type === "conversation.agent") {
        addTurn(call, at, event.type === "conversation.user" ? "caller" : "agent", event.payload.text, eventId);
      }
    }
  }

  const rows = [];
  const decisions = [];
  for (const call of calls.values()) {
    const greeting = [...call.turns.values()].find((turn) => turn.speaker === "agent" && /^Clínica (Sanitas|Quirón|Arenal)[, ]/.test(turn.text));
    call.org ??= greeting?.text.startsWith("Clínica Sanitas") ? "sanitas"
      : greeting?.text.startsWith("Clínica Quirón") ? "quironsalud" : "arenal";
    const events = [...call.events.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const ended = events.filter((event) => event.type === "call.ended").at(-1);
    const route = events.filter((event) => event.type === "route.decided").at(-1)?.payload ?? {};
    const end = ended?.payload ?? {};
    const caller = [...call.turns.values()].filter((turn) => turn.speaker === "caller");
    const confirmed = call.outcome !== "sin_cierre" || (end.outcome && end.outcome !== "sin_cierre");
    const useful = caller.some((turn) => substantive(turn.text));
    const keep = !exclusions[call.id] && Boolean(confirmed || useful);
    decisions.push({ id: call.id, org: call.org, keep, reason: exclusions[call.id] ?? (confirmed ? "confirmed_outcome"
      : useful ? "substantive_conversation" : caller.length ? "greeting_silence_or_mic_test" : "no_caller_conversation"),
      turns: call.turns.size, sourceFiles: [...call.sources].sort() });
    if (!keep) { stats.skippedCalls++; continue; }
    if (org && call.org !== org) continue;
    const endedAt = ended?.occurredAt ?? (call.close && call.close >= call.last ? call.close : null);
    if (!endedAt) stats.incompleteCalls++;
    const summary = {
      callId: call.id, orgSlug: call.org, configVersion: ended?.configVersion ?? events.at(-1)?.configVersion ?? "log-import",
      outcome: typeof end.outcome === "string" ? end.outcome : call.outcome,
      reason: typeof end.reason === "string" ? end.reason : call.reason,
      site: ["centro", "norte", "sur"].includes(end.site) ? end.site : call.site,
      durationMs: Number.isFinite(end.durationMs) ? number(end.durationMs) : Math.max(0, Date.parse(endedAt ?? call.last) - Date.parse(call.start)),
      toolCalls: Math.max(number(end.toolCalls), call.toolCalls, events.filter((e) => e.type === "tool.called").length),
      toolErrors: Math.max(number(end.toolErrors), call.toolErrors, events.filter((e) => e.type === "tool.failed").length),
      userTurns: Math.max(number(end.userTurns), [...call.turns.values()].filter((t) => t.speaker === "caller").length),
      intent: end.intent ?? route.intent ?? null, route: end.route ?? route.route ?? null,
      frustrationScore: number(end.frustrationScore ?? route.frustrationScore), zeroRetention: true,
      importSource: IMPORT_SOURCE, importIncomplete: !endedAt, sourceFiles: [...call.sources].sort(),
    };
    rows.push({ id: call.id, org: call.org, startedAt: call.start, endedAt, summary, events,
      turns: [...call.turns.values()].sort((a, b) => a.at.localeCompare(b.at)) });
  }
  rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  return { calls: rows, decisions, stats: { ...stats, calls: rows.length,
    transcripts: rows.reduce((n, call) => n + call.turns.length, 0),
    events: rows.reduce((n, call) => n + call.events.length, 0),
    organizations: Object.fromEntries([...new Set(rows.map((c) => c.org))].sort().map((name) => [name, rows.filter((c) => c.org === name).length])) } };
}

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

export async function readSources(directory) {
  const files = new Map();
  async function walk(dir, prefix = "") {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(prefix, entry.name);
      if (entry.isDirectory()) await walk(join(dir, entry.name), name);
      else if (entry.isFile() && (entry.name.endsWith(".log") || entry.name === "call-events.jsonl" || entry.name === "import-exclusions.json")) {
        files.set(name, await readFile(join(dir, entry.name), "utf8"));
      }
    }
  }
  await walk(directory);
  return files;
}

async function main() {
  const { values } = parseArgs({ options: {
    logs: { type: "string", default: join(ROOT, "logs") }, org: { type: "string" },
    report: { type: "string" }, out: { type: "string" }, apply: { type: "boolean" }, remote: { type: "boolean" },
    local: { type: "boolean" }, "dry-run": { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: npm run calls:import -- [--logs DIR] [--org arenal] [--out FILE.sql] [--report FILE.json]\nDefault: dry-run counts only. Write to D1 with --apply --remote (or --apply --local).\nUses prosper_desk in desk/wrangler.jsonc. Requires migrations 0002–0004.");
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
  if (values.report) await writeFile(resolve(values.report), JSON.stringify(plan.decisions, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (values.out) {
    await writeFile(resolve(values.out), importSql(plan), { flag: "wx", mode: 0o600 });
    console.log(`SQL written to ${resolve(values.out)}`);
  }
  if (!values.apply) return;
  const directory = await mkdtemp(join(tmpdir(), "prosper-call-import-"));
  try {
    const file = join(directory, "calls.sql");
    await writeFile(file, importSql(plan), { mode: 0o600 });
    const result = spawnSync(process.execPath, [join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
      "d1", "execute", "prosper_desk", "--config", join(ROOT, "desk/wrangler.jsonc"),
      values.remote ? "--remote" : "--local", "--file", file, "--yes"], { cwd: ROOT, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`D1 import failed (${result.status ?? result.signal}); rerunning is safe.`);
    console.log("Import finished. Existing live records were left unchanged.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
