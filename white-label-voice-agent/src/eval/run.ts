import { readFileSync } from "node:fs";
import { PlatformClient } from "../platform/client.ts";
import { clinicTools, type CallContext, type CapturedAction } from "../clinic/tools.ts";
import { Conversation } from "../voice/conversation.ts";
import { FIRST_MESSAGE } from "../voice/prompt.ts";
import { generateText, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { models } from "../config.ts";
import { CallerSim } from "./caller.ts";
import { scoreCase } from "./score.ts";

type Case = {
  id: string;
  problem_id: string;
  language: string;
  persona: { name: string; data: Record<string, string> };
  caller_prompt: string;
  summary: string;
  expected: { acceptable: { actions: Record<string, unknown>[] }[] };
};

const CASES_PATH =
  process.env.WL_CASES ?? "../../hackspain-prosper-ai/task/public-cases.json";
const MAX_TURNS = 12;
const CONCURRENCY = Number(process.env.WL_EVAL_CONCURRENCY ?? 1);

const filter = process.argv[2]; // opcional: problem_id o substring de case id
const all: Case[] = JSON.parse(readFileSync(CASES_PATH, "utf8")).cases;
const cases = filter ? all.filter((c) => c.problem_id === filter || c.id.includes(filter)) : all;

async function runCase(c: Case): Promise<{ pass: boolean; got: string; expected: string }> {
  const captured: CapturedAction[] = [];
  const ctx: CallContext = {
    callId: `eval-${c.id}`,
    fromNumber: c.persona.data.phone ?? null,
    platform: new PlatformClient(),
    submitted: null,
    capture: captured,
  };
  // Cerebro real, con las tools reales (search_* leen Prosper; submit_* dry).
  const convo = new Conversation(ctx, "");
  // Reproducimos el saludo y dejamos que el paciente arranque.
  const caller = new CallerSim(c.persona, c.caller_prompt, c.language);
  let agentLine = FIRST_MESSAGE;

  for (let turn = 0; turn < MAX_TURNS && ctx.submitted === null; turn++) {
    const callerLine = await caller.reply(agentLine);
    if (callerLine.includes("<END>")) break;
    agentLine = await convo.respond(callerLine);
  }

  const { pass, expected } = scoreCase(captured, c.expected.acceptable);
  const got = captured.length
    ? captured.map((a) => `${a.action}(${Object.entries(a).filter(([k]) => k !== "action").map(([k, v]) => `${k}=${v}`).join(",")})`).join("+")
    : "∅ sin submit";
  return { pass, got, expected };
}

// Pool de concurrencia sencillo.
const results: { c: Case; pass: boolean; got: string; expected: string }[] = [];
let idx = 0;
async function worker() {
  while (idx < cases.length) {
    const c = cases[idx++]!;
    try {
      const r = await runCase(c);
      results.push({ c, ...r });
      process.stdout.write(r.pass ? "." : "x");
    } catch (e) {
      results.push({ c, pass: false, got: `ERROR ${e instanceof Error ? e.message : e}`, expected: "" });
      process.stdout.write("E");
    }
  }
}
console.log(`Evaluando ${cases.length} casos (dry-run, sin harness)…`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

// Resumen por problema.
const byProblem = new Map<string, { pass: number; total: number }>();
for (const r of results) {
  const p = byProblem.get(r.c.problem_id) ?? { pass: 0, total: 0 };
  p.total++;
  if (r.pass) p.pass++;
  byProblem.set(r.c.problem_id, p);
}
console.log("=== por problema ===");
for (const [p, s] of [...byProblem].sort((a, b) => a[1].pass / a[1].total - b[1].pass / b[1].total)) {
  console.log(`  ${s.pass === s.total ? "✅" : s.pass === 0 ? "❌" : "⚠️ "} ${p.padEnd(18)} ${s.pass}/${s.total}`);
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n=== TOTAL: ${passed}/${results.length} (${Math.round((100 * passed) / results.length)}%) ===`);

console.log("\n=== fallos ===");
for (const r of results.filter((r) => !r.pass)) {
  console.log(`\n[${r.c.problem_id}] ${r.c.id}  (${r.c.persona.name})`);
  console.log(`  esperado: ${r.expected}`);
  console.log(`  enviado : ${r.got}`);
}
process.exit(0);
