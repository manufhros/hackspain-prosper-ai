import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const logRoots = [join(root, "logs"), join(root, "logs", "old")];
const outFile = join(root, "desk", "lib", "from-logs.json");
const eventFile = join(root, "logs", "call-events.jsonl");

const SITES = {
  centro: "Arenal Centro",
  norte: "Arenal Norte",
  sur: "Arenal Sur",
};

function parseLine(line) {
  const m = line.match(/^\[([^\]]+)\]\s+(.*)$/);
  if (!m) return null;
  return { stamp: m[1], rest: m[2] };
}

function jsonAfter(rest, marker) {
  const i = rest.indexOf(marker);
  if (i < 0) return null;
  const slice = rest.slice(i + marker.length).trim();
  const start = slice.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(slice.slice(start));
  } catch {
    return null;
  }
}

async function collectFiles() {
  const files = [];
  for (const dir of logRoots) {
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".log")) continue;
      files.push(join(dir, name));
    }
  }
  return files;
}

const calls = new Map();
const analytics = new Map();

function ensure(id) {
  if (!calls.has(id)) {
    calls.set(id, {
      id,
      phone: null,
      started: null,
      ended: null,
      patient: null,
      insurer: null,
      users: [],
      agents: [],
      tools: [],
      submits: [],
      site: null,
      sourceFile: null,
    });
  }
  return calls.get(id);
}

for (const file of await collectFiles()) {
  const text = await readFile(file, "utf8");
  for (const raw of text.split("\n")) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const { stamp, rest } = parsed;

    const start = rest.match(/^call start ([0-9a-f-]{36})(?:\s+(\S+))?/i);
    if (start) {
      const row = ensure(start[1]);
      row.started ??= stamp;
      row.phone ??= start[2] ?? null;
      row.sourceFile ??= file.split("/").slice(-2).join("/");
      continue;
    }

    const tag = rest.match(/^([0-9a-f]{8})\s+(.*)$/);
    if (!tag) continue;
    const id8 = tag[1];
    const body = tag[2];
    let row = [...calls.values()].find((c) => c.id.startsWith(id8));
    if (!row) {
      row = ensure(id8);
      row.sourceFile ??= file.split("/").slice(-2).join("/");
    }

    if (body.startsWith("user ")) {
      const t = body.slice(5).trim();
      if (t && t.length > 1) row.users.push(t);
    }
    if (body.startsWith("agent ")) {
      const t = body.slice(6).trim();
      if (t) row.agents.push(t);
    }
    if (body.startsWith("tool ")) {
      const tool = body.match(/^tool (\S+)\s+(\{.*)$/);
      if (tool) {
        let params = {};
        try {
          params = JSON.parse(tool[2]);
        } catch {
          params = {};
        }
        row.tools.push({ name: tool[1], params, at: stamp });
        if (params.location_id) row.site = params.location_id;
        if (String(tool[1]).startsWith("submit_")) {
          row.submits.push({ name: tool[1], params, at: stamp });
        }
      }
    }
    if (body.startsWith("tool result search_directory")) {
      const payload = jsonAfter(body, "tool result search_directory");
      const one = payload?.matches?.[0];
      if (one) {
        row.patient ??= `${one.given_name ?? ""} ${one.first_surname ?? ""} ${one.second_surname ?? ""}`.trim();
        row.insurer ??= one.insurer ?? null;
        row.patientId ??= one.patient_id ?? null;
      }
    }
    if (body.startsWith("elevenlabs closed") || body.includes("flushed")) {
      row.ended = stamp;
    }
  }
}

try {
  const text = await readFile(eventFile, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event.callId || !event.type) continue;
    const row = analytics.get(event.callId) ?? {
      toolCalls: 0,
      toolErrors: 0,
      toolLatency: [],
      frustrationScore: 0,
      patientRating: null,
      sentiment: null,
      route: null,
      intent: null,
      resolution: "unknown",
      configVersion: event.configVersion ?? null,
    };
    if (event.type === "tool.called") row.toolCalls += 1;
    if (event.type === "tool.failed" || (event.type === "tool.completed" && event.payload?.ok === false)) {
      row.toolErrors += 1;
    }
    if (event.type === "tool.completed" && Number.isFinite(event.payload?.latencyMs)) {
      row.toolLatency.push(event.payload.latencyMs);
    }
    if (event.type === "route.decided") {
      row.route = event.payload?.route ?? row.route;
      row.intent = event.payload?.intent ?? row.intent;
      row.frustrationScore = Math.max(row.frustrationScore, event.payload?.frustrationScore ?? 0);
    }
    if (event.type === "call.ended") {
      row.frustrationScore = event.payload?.frustrationScore ?? row.frustrationScore;
      row.durationMs = event.payload?.durationMs;
      row.resolution =
        event.payload?.outcome === "sin_cierre"
          ? "abandoned"
          : event.payload?.outcome === "escalado"
            ? "escalated"
            : "resolved";
    }
    if (event.type === "survey.rating") row.patientRating = event.payload?.score ?? null;
    if (event.type === "analysis.completed") row.sentiment = event.payload?.sentiment ?? null;
    analytics.set(event.callId, row);
  }
} catch {
  // Structured events are optional for legacy logs.
}

const SITE_HINT = [
  ["arenal sur", "sur"],
  ["arenal norte", "norte"],
  ["arenal centro", "centro"],
  [" getafe", "sur"],
];

function inferSite(row) {
  if (row.site && SITES[row.site]) return row.site;
  const blob = [...row.users, ...row.agents].join(" ").toLowerCase();
  for (const [needle, id] of SITE_HINT) {
    if (blob.includes(needle)) return id;
  }
  return row.site;
}

function minutes(row) {
  if (!row.started || !row.ended) return 3.5;
  const a = Date.parse(row.started.replace(",", ".").replace(" CEST", "+02:00").replace(" CET", "+01:00"));
  const b = Date.parse(row.ended.replace(",", ".").replace(" CEST", "+02:00").replace(" CET", "+01:00"));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 3.5;
  return Math.min(12, Math.max(1, (b - a) / 60000));
}

function outcome(row) {
  const last = row.submits.at(-1);
  if (!last) return { kind: "sin_cierre", reason: null };
  if (last.name === "submit_book") return { kind: "cita", reason: last.params.slot ?? null };
  if (last.name === "submit_register") return { kind: "alta", reason: null };
  if (last.name === "submit_escalate") return { kind: "escalado", reason: last.params.reason ?? null };
  if (last.name === "submit_no_action") return { kind: "sin_cita", reason: last.params.reason ?? null };
  if (last.name === "submit_cancel") return { kind: "cancelacion", reason: null };
  if (last.name === "submit_reschedule") return { kind: "cambio", reason: null };
  return { kind: last.name, reason: null };
}

function motive(row) {
  const line = row.users.find((t) => t.length > 18) ?? row.users[0] ?? "";
  return line.replace(/\s+/g, " ").slice(0, 160);
}

const rows = [...calls.values()]
  .filter((row) => row.users.length || row.submits.length)
  .map((row) => {
    const site = inferSite(row);
    const out = outcome(row);
    const quality = analytics.get(row.id) ?? {};
    const toolLatency = quality.toolLatency ?? [];
    const avgToolLatencyMs = toolLatency.length
      ? Math.round(toolLatency.reduce((sum, value) => sum + value, 0) / toolLatency.length)
      : null;
    return {
      id: row.id.length === 8 ? row.id : row.id,
      phone: row.phone,
      started: row.started,
      minutes: Number(minutes(row).toFixed(1)),
      patient: row.patient,
      patientId: row.patientId ?? null,
      insurer: row.insurer,
      site,
      siteName: SITES[site] ?? (site || "Sin sede"),
      outcome: out.kind,
      reason: out.reason,
      motive: motive(row),
      slot: row.submits.find((s) => s.params.slot)?.params.slot ?? null,
      providerId: row.submits.find((s) => s.params.provider_id)?.params.provider_id ?? null,
      source: "llamadas",
      sourceFile: row.sourceFile,
      resolution: quality.resolution ?? (out.kind === "sin_cierre" ? "abandoned" : out.kind === "escalado" ? "escalated" : "resolved"),
      route: quality.route ?? null,
      intent: quality.intent ?? null,
      toolCalls: quality.toolCalls ?? row.tools.length,
      toolErrors: quality.toolErrors ?? 0,
      avgToolLatencyMs,
      frustrationScore: quality.frustrationScore ?? 0,
      sentiment: quality.sentiment ?? null,
      patientRating: quality.patientRating ?? null,
      escalationAppropriate: out.kind === "escalado" ? Boolean(out.reason) : null,
      configVersion: quality.configVersion ?? null,
      actions: row.tools.map((tool) => ({
        name: tool.name,
        at: tool.at ?? null,
        reason: tool.params.reason ?? null,
        summary:
          tool.name === "search_directory"
            ? "Buscó y verificó la ficha del paciente"
            : tool.name === "search_availability"
              ? "Consultó disponibilidad real de agenda"
              : tool.name === "list_appointments"
                ? "Consultó las próximas citas"
                : tool.name === "submit_book"
                  ? "Reservó una cita confirmada"
                  : tool.name === "submit_escalate"
                    ? `Escaló al equipo humano${tool.params.reason ? `: ${tool.params.reason}` : ""}`
                    : tool.name === "submit_no_action"
                      ? `Cerró sin acción${tool.params.reason ? `: ${tool.params.reason}` : ""}`
                      : tool.name === "submit_cancel"
                        ? "Canceló una cita"
                        : tool.name === "submit_reschedule"
                          ? "Cambió una cita"
                          : tool.name === "submit_register"
                            ? "Registró un nuevo paciente"
                            : tool.name,
      })),
    };
  });

const byId = new Map();
for (const row of rows) {
  const key = row.id;
  const prev = byId.get(key);
  if (!prev || (row.submits?.length ?? 0) > 0) byId.set(key, row);
}

const unique = [...byId.values()];

await mkdir(dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  JSON.stringify(
    {
      extractedAt: new Date().toISOString(),
      clinic: "Clínica Arenal",
      note: "Derivado de logs/ (transcripciones y tools). No es el leaderboard.",
      callCount: unique.length,
      calls: unique,
    },
    null,
    2,
  ),
);

console.log(`wrote ${unique.length} calls → ${outFile}`);
