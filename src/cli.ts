import { cases, documents, operations, problems, caseById } from "./data";
import { evaluateBatch, parseResults } from "./evaluate";
import { contractDiagnostics } from "./labs";
import { inspectTrace } from "./protocol";
import { readJson } from "./storage";

const help = `El Turno — Bun hackathon test workbench

bun start                         TUI + automatic local voice setup/start
bun start --offline               TUI without downloads or local processes
bun src/cli.ts cases               List all 73 archived public cases
bun src/cli.ts case <id>           Inspect one complete public fixture
bun src/cli.ts template            Empty results for every public case (JSON)
bun run evaluate <results.json>    Compare a result batch; emits JSON
bun src/cli.ts trace <trace.json>  Validate inbound Twilio messages
bun run doctor                    Offline archive + contract self-check
bun run check                     Typecheck and unit tests; no servers

TUI: 1–7 or Tab sections; arrows/j/k select; PgUp/PgDn read;
/ filter; Enter open/run; e enter outcome; a toggle archived answers;
v voice rehearsal; m microphone; i import; x export; c cancel voice test;
Esc back; q or Ctrl-C quit and stop owned local processes.

Evaluation input: [{ case_id, record: { actions: [...] },
  transcript?: [{ role: "agent" | "caller", text }], reference_time?: ISO }]
Trace input: [{ connection: "socket-1", message: { event: ... } }]

Local voice starts with bun start: Ollama/Qwen3.5, MLX Whisper and Piper.
No provider subscription or tunnel is required. --offline skips local setup.
Local results are not official scores; saved answers use Friday's anchor.
Put PLATFORM_API_KEY in .env; host defaults to hackspain.getprosperapp.com.
Clinic lookups are real and read-only. Voice actions remain local.
Practice, Run All, integration settings and recordings use the dashboard.
Exit codes: 0 success/pass; 1 failed/unverified diagnostic; 2 invalid input.
`;
async function main() {
  const [command, argument] = process.argv.slice(2);
  if (!command || command === "--offline") { const { Workbench } = await import("./workbench"); await new Workbench().start(command !== "--offline"); return; }
  if (["--help", "-h", "help"].includes(command)) { console.log(help); return; }
  if (command === "cases") {
    console.log(problems.flatMap(p => p.cases.map(c => `${c.id}\t${c.language}\t${c.summary || c.persona.objectives[0]}`)).join("\n")); return;
  }
  if (command === "case") { if (!argument) throw new Error("Pass a public case ID"); console.log(JSON.stringify(caseById(argument), null, 2)); return; }
  if (command === "template") {
    console.log(JSON.stringify(cases.map(c => ({ case_id: c.id, reference_time: c.reference_time, record: { actions: [] } })), null, 2)); return;
  }
  if (command === "evaluate") {
    if (!argument) throw new Error("Pass a results JSON file; see --help for its format");
    const report = evaluateBatch(parseResults(await readJson(argument)));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.evaluations.length > 0 && report.evaluations.every(r => r.status === "pass") ? 0 : 1; return;
  }
  if (command === "trace") {
    if (!argument) throw new Error("Pass an inbound trace JSON file");
    const report = inspectTrace(await readJson(argument));
    console.log(JSON.stringify(report, null, 2)); process.exitCode = report.valid ? 0 : 1; return;
  }
  if (command === "doctor") {
    const report = contractDiagnostics();
    console.log(JSON.stringify({ documents: Object.keys(documents).length, public_cases: cases.length, problems: problems.length,
      api_endpoints: operations.length, reference_time: cases[0]!.reference_time, runtime: Bun.version,
      live_verified: false, ...report }, null, 2)); process.exitCode = report.okay ? 0 : 1; return;
  }
  throw new Error(`Unknown command: ${command}. Use --help.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; });
