import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { directoryIdentity, eventIdentity, spokenIdentity } from "./caller-identity.ts";
import { substantive } from "./call-text.ts";
export { substantive };

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

function json(value) {
  try { const parsed = JSON.parse(value); return record(parsed) ? parsed : null; }
  catch { return null; } // Older text logs truncate some provider responses.
}

/** Parse sources in memory. No network, database, or filesystem mutations.
 * @param {Map<string, string>} files
 * @param {{ org?: string, includeAll?: boolean }} options
 */
export function buildImport(files, { org, includeAll = false } = {}) {
  const exclusions = json(files.get("import-exclusions.json") ?? "{}") ?? {};
  const calls = new Map();
  const globalIds = new Set([...files].filter(([name]) => name.endsWith(".log"))
    .flatMap(([, text]) => [...text.matchAll(/\] call start (\S+)/g)].map((match) => match[1])));
  const stats = { files: files.size, ambiguousLines: 0, orphanLines: 0, incompleteCalls: 0, skippedCalls: 0 };
  const ensure = (id) => {
    if (!calls.has(id)) calls.set(id, { id, org: null, start: null, last: null, close: null,
      turns: new Map(), events: new Map(), logTools: new Map(), sources: new Set(), toolCalls: 0, toolErrors: 0,
      origin: "phone", startKnown: false, outcome: "sin_cierre", reason: null, site: null, identities: [] });
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

  const addTool = (call, at, type, name, payload) => {
    const eventId = `log-tool-${hash(JSON.stringify([call.id, at, type, name]))}`;
    call.logTools.set(eventId, { eventId, schemaVersion: 1, callId: call.id, configVersion: "log-import",
      type, occurredAt: at, payload: { toolName: name, importSource: IMPORT_SOURCE, ...payload } });
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
      if (start) { ids.add(start[1]); touch(ensure(start[1]), at, source); ensure(start[1]).startKnown = true; }
      const stream = body.match(/^stream start (\S+) (\{.*)$/);
      const params = stream && json(stream[2]);
      if (params && !params.join && !params.Join) {
        const id = params.call_id || stream[1];
        ids.add(id);
        setOrg(ensure(id), params.org_slug);
        if (params.simulation != null) ensure(id).origin = "simulator";
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
        addTurn(call, at, turn[1] === "agent" ? "agent" : "caller", turn[2]);
      }
      const tool = message.match(/^tool (\w+) (\{.*)$/);
      if (tool) {
        call.toolCalls++;
        const params = json(tool[2]);
        addTool(call, at, "tool.called", tool[1], params ? { parameters: params } : { truncated: true });
        if (["centro", "norte", "sur"].includes(params?.location_id)) call.site = params.location_id;
      }
      if (level === "ERROR" && message.startsWith("tool error ")) {
        call.toolErrors++;
        const failed = message.match(/^tool error (\w+) ([\w]+Error)/);
        if (failed) addTool(call, at, "tool.failed", failed[1], { ok: false, errorType: failed[2] });
      }
      const toolResult = message.match(/^tool result (\w+) (.*)$/);
      if (toolResult) {
        const result = json(toolResult[2]);
        if (result?.simulated === true) call.origin = "simulator";
        addTool(call, at, "tool.completed", toolResult[1], result
          ? { result, ok: !result.error } : { truncated: true });
      }
      if (message.startsWith("tool result search_directory ")) {
        const raw = message.slice("tool result search_directory ".length);
        // Logs truncate at 800 characters, often after the complete matches array.
        // Recover only a closed array, never a possibly incomplete candidate list.
        const closed = raw.match(/^\{"matches":(\[.*\])(?:,|\})/);
        const identity = directoryIdentity(json(raw) ?? (closed ? json(`{"matches":${closed[1]}}`) : null));
        if (identity) call.identities.push({ at, identity });
      }
      const result = message.match(/^tool result (submit_\w+) (\{.*)$/);
      const payload = result && json(result[2]);
      // Tool requests are not evidence of a successful action.
      const action = payload?.record?.actions?.find((item) => item.action === result[1].slice(7).toUpperCase());
      const received = payload?.call_id === call.id && typeof payload.received_at === "string" && action;
      if ((payload?.accepted === true || received) && !payload.error && !payload.held && !payload.simulated && OUTCOMES[result[1]] && (!call.outcomeAt || at >= call.outcomeAt)) {
        if (action?.action === "REGISTER") {
          const identity = directoryIdentity({ matches: [action.new_patient] });
          if (identity) call.identities.push({ at, identity });
        }
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
      if (includeAll && !event && index === text.split(/\r?\n/).length - 1 && !text.endsWith("\n")) continue; // A concurrent append may be incomplete.
      if (!event || typeof event.callId !== "string" || !event.callId ||
          typeof event.type !== "string" || !record(event.payload)) {
        throw new Error(`Invalid structured event at ${source}:${index + 1}`);
      }
      const at = timestamp(event.occurredAt);
      const call = ensure(event.callId);
      touch(call, at, source);
      setOrg(call, event.payload.orgSlug);
      if (event.type === "call.started") call.startKnown = true;
      if (event.payload.demo === true || event.payload.simulation === true || event.payload.source === "simulator" || event.payload.origin === "simulator") call.origin = "simulator";
      else if (call.origin !== "simulator" && event.payload.origin === "phone") call.origin = "phone";
      const eventId = event.eventId || `log-event-${hash(line)}`;
      call.events.set(eventId, { ...event, eventId, occurredAt: at });
      const identity = eventIdentity(event.type, event.payload);
      if (identity) call.identities.push({ at, identity });
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
    // Enrich matching structured events instead of displaying each source twice.
    const matched = new Set();
    const structuredTools = [...call.events.values()];
    for (const event of call.logTools.values()) {
      const existing = structuredTools.find(candidate => !matched.has(candidate.eventId) &&
        (candidate.type === event.type || (event.type === "tool.called" && candidate.type === "tool.received")) &&
        (candidate.payload.toolName ?? candidate.payload.name) === event.payload.toolName &&
        Math.abs(Date.parse(candidate.occurredAt) - Date.parse(event.occurredAt)) <= 1000);
      if (existing) {
        matched.add(existing.eventId);
        existing.payload = { ...event.payload, ...existing.payload };
      } else call.events.set(event.eventId, event);
    }
    const events = [...call.events.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const ended = events.filter((event) => event.type === "call.ended").at(-1);
    const route = events.filter((event) => event.type === "route.decided").at(-1)?.payload ?? {};
    const end = ended?.payload ?? {};
    const caller = [...call.turns.values()].filter((turn) => turn.speaker === "caller");
    const confirmed = call.outcome !== "sin_cierre" || (end.outcome && end.outcome !== "sin_cierre");
    const useful = caller.some((turn) => substantive(turn.text));
    const keep = !exclusions[call.id] && Boolean(includeAll || confirmed || useful);
    decisions.push({ id: call.id, org: call.org, keep, reason: exclusions[call.id] ?? (confirmed ? "confirmed_outcome"
      : useful ? "substantive_conversation" : caller.length ? "greeting_silence_or_mic_test" : "no_caller_conversation"),
      turns: call.turns.size, sourceFiles: [...call.sources].sort() });
    if (!keep) { stats.skippedCalls++; continue; }
    if (org && call.org !== org) continue;
    const endedAt = ended?.occurredAt ?? (call.close && call.close >= call.last ? call.close : null);
    if (!endedAt) stats.incompleteCalls++;
    const turns = [...call.turns.values()].sort((a, b) => a.at.localeCompare(b.at));
    let spoken;
    let previousAgent = "";
    for (const turn of turns) {
      if (turn.speaker === "agent") previousAgent = turn.text;
      else spoken = spokenIdentity(turn.text, previousAgent) ?? spoken;
    }
    const identity = call.identities.sort((a, b) => a.at.localeCompare(b.at)).at(-1)?.identity ?? spoken;
    const summary = {
      ...identity,
      callId: call.id, orgSlug: call.org, configVersion: ended?.configVersion ?? events.at(-1)?.configVersion ?? "log-import",
      origin: call.origin,
      outcome: typeof end.outcome === "string" ? end.outcome : call.outcome,
      reason: typeof end.reason === "string" ? end.reason : call.reason,
      site: typeof end.site === "string" ? end.site : call.site,
      durationMs: Number.isFinite(end.durationMs) && end.durationMs >= 0 ? end.durationMs : (endedAt && call.startKnown ? Math.max(0, Date.parse(endedAt) - Date.parse(call.start)) : null),
      toolCalls: Math.max(number(end.toolCalls), call.toolCalls, events.filter((e) => e.type === "tool.called").length),
      toolErrors: Math.max(number(end.toolErrors), call.toolErrors, events.filter((e) => e.type === "tool.failed").length),
      userTurns: Math.max(number(end.userTurns), [...call.turns.values()].filter((t) => t.speaker === "caller").length),
      motive: caller.find(turn => substantive(turn.text))?.text.slice(0, 160) ?? "",
      intent: end.intent ?? route.intent ?? null, route: end.route ?? route.route ?? null,
      frustrationScore: Number.isFinite(end.frustrationScore ?? route.frustrationScore) ? (end.frustrationScore ?? route.frustrationScore) : undefined, zeroRetention: true,
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

