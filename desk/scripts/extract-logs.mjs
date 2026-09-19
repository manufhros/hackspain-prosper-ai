import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildImport, readSources } from "../../src/agent/log-records.mjs";
import { callFromRow } from "../lib/call-records.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const plan = buildImport(await readSources(join(root, "logs")), { org: "arenal", includeAll: true });
const calls = plan.calls.map(record => callFromRow({
  call_id: record.id, started_at: record.startedAt, summary: JSON.stringify(record.summary),
}));
const outFile = join(root, "desk/lib/from-logs.json");
await writeFile(outFile, JSON.stringify({
  extractedAt: new Date().toISOString(), clinic: "Clínica Arenal",
  note: "Exportación para análisis. El panel lee los registros actuales, no este archivo.",
  callCount: calls.length, calls,
}, null, 2) + "\n");
console.log(`wrote ${calls.length} calls → ${outFile}`);
