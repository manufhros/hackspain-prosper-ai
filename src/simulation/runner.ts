import { parseArgs } from "node:util";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, saveLocal, stateDir } from "../storage";
import { clinicClient } from "../voice/platform";
import { LocalRuntime } from "../voice/runtime";
import { modelConfig } from "../voice/model";
import { localSettings } from "../voice/settings";
import { transcriptionConfig } from "../voice/transcription";
import { muLawWav } from "../voice/audio-wav";
import { evaluate } from "../evaluate";
import { delay } from "../telephony/audio";
import type { PlatformCallReport } from "../telephony/call";
import { generateScenario, type Kind, type Language, type Scenario } from "./scenario";
import { localTarget, websocketTarget, requireDryRun, runSimulatedCall, type CallResult } from "./call";
import { LivePlayback } from "./playback";
import { callCount, callPlans, runCallBatch, sharedCallerInference } from "./batch";

export const simulationHelp = `Simulate real audio calls against an ALREADY RUNNING receptionist.

Terminal 1: bun run serve --dry-run       Wait for Ready (stop a live-mode server first).
Terminal 2: bun run simulate:call

Options:
  --language en|es|ca       Random when omitted
  --kind book|cancel|reschedule  Random when omitted
  --seed <text>            Repeat selection against the same live DB and date
  --endpoint <ws-url>      Default ws://127.0.0.1:7860/ws; loopback only
  --ws-url <ws[s]-url>     Test another implementation; no local health/report dependency
  --calls <number>        Simultaneous calls, 1–50 (default 1); batches mute speakers
  --prepare-only          Fetch and save scenarios; no socket, caller or models
  --mute                  Disable live speaker playback (on by default for one call)
  --help                  Show this help without contacting any service

Uses PLATFORM_API_KEY for read-only live clinic data, OPENROUTER_API_KEY for
caller chat and listening, and local Piper for caller speech.
Model selection: SIM_CALLER_MODEL, then OPENROUTER_MODEL, then openai/gpt-4.1-mini.
The caller inherits OPENROUTER token, timeout, reasoning and routing settings.
VOICE_SERVER_TOKEN is reused for local mode; SIM_TARGET_TOKEN authenticates --ws-url.
Local mode requires this checkout and checks dry-run mode. With --ws-url, configure
the target for synthetic calls yourself; its submission mode cannot be verified.
Artifacts: .workbench/simulation-<id>.json, scenario snapshots and per-turn WAVs;
multiple calls also save simulation-batch-<id>.json with counts and report paths.
Calls share up to 4 Piper workers and 20 ASR requests; caller latency affects load.
This is not the official Prosper caller/judge. External action outcomes are not graded.
`;

export function simulationTarget(options: { endpoint?: string; "ws-url"?: string },
  env: Record<string, string | undefined> = process.env) {
  if (options.endpoint !== undefined && options["ws-url"] !== undefined)
    throw new Error("Use either --endpoint for this checkout or --ws-url for another implementation");
  if (options["ws-url"] !== undefined) return {
    socket: websocketTarget(options["ws-url"]), health: undefined, token: env.SIM_TARGET_TOKEN?.trim(),
  };
  return { ...localTarget(options.endpoint ?? `ws://127.0.0.1:${env.VOICE_PORT || "7860"}/ws`), token: env.VOICE_SERVER_TOKEN?.trim() };
}

export function externalCallStatus(call: CallResult) {
  return call.close_code === 1000 && !call.errors.length ? "connected_and_closed" : "fail";
}

export function callerModelConfig(env: Record<string, string | undefined> = process.env) {
  // Reuse the user's chosen hosted model even when the receptionist runs locally.
  // An explicit simulator override wins; never silently retry on a different model.
  return modelConfig({ ...env, LLM_PROVIDER: "openrouter",
    OPENROUTER_MODEL: env.SIM_CALLER_MODEL?.trim() || env.OPENROUTER_MODEL?.trim() || "openai/gpt-4.1-mini" });
}

export function gradeCall(scenario: Scenario, call: CallResult, report?: PlatformCallReport) {
  const evaluation = evaluate(scenario.case, report?.record, report?.transcript, report?.reference_time);
  evaluation.warnings = ["Local comparison against a live-data-generated oracle using published action normalization; not an official Prosper score.",
    ...evaluation.warnings.slice(1)];
  const errors = [...call.errors, ...(report?.errors ?? [])];
  if (call.close_code !== 1000) errors.push(`Socket did not close normally (code ${call.close_code ?? "unknown"})`);
  if (!report) errors.push("Receptionist report was not found in this checkout within 30 seconds");
  else {
    if (report.call_id !== call.call_id) errors.push("Receptionist report belongs to a different call");
    if (report.mode !== "dry_run") errors.push("Receptionist was not in dry-run mode");
    if (report.status !== "completed") errors.push(`Receptionist call did not complete: ${report.end_reason ?? report.status}`);
    if (!report.submissions.length || report.submissions.some(s => !s.dry_run || s.accepted)) errors.push("Missing or non-dry-run submission receipts");
  }
  if (errors.length) { evaluation.status = "fail"; evaluation.differences.push(...errors.map(e => `execution: ${e}`)); }
  return evaluation;
}

async function reportFiles() {
  try { return (await readdir(stateDir)).filter(name => /^platform-[a-zA-Z0-9-]+\.json$/.test(name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function waitForReport(callId: string, before: Set<string>, signal: AbortSignal): Promise<PlatformCallReport | undefined> {
  const deadline = Date.now() + 30000;
  do {
    for (const name of await reportFiles()) {
      if (before.has(name)) continue;
      const value = await Bun.file(join(stateDir, name)).json();
      if (value.call_id === callId) return value as PlatformCallReport;
      before.add(name);
    }
    if (signal.aborted) return;
    await delay(250, signal);
  } while (Date.now() < deadline);
}

export async function simulate(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, strict: true, allowPositionals: true, options: {
    help: { type: "boolean" }, mute: { type: "boolean" }, "prepare-only": { type: "boolean" }, seed: { type: "string" },
    language: { type: "string" }, kind: { type: "string" }, endpoint: { type: "string" }, "ws-url": { type: "string" },
    calls: { type: "string" },
  } });
  if (values.help) { console.log(simulationHelp); return; }
  if (positionals.length) throw new Error("Unexpected argument; use bun run simulate:call --help");
  if (values.language && !["en", "es", "ca"].includes(values.language)) throw new Error("--language must be en, es or ca");
  if (values.kind && !["book", "cancel", "reschedule"].includes(values.kind)) throw new Error("--kind must be book, cancel or reschedule");
  const seed = values.seed ?? crypto.randomUUID();
  if (!seed.trim() || seed.length > 200) throw new Error("--seed must contain 1–200 characters");
  const endpoint = simulationTarget(values);
  const count = callCount(values.calls), muted = !!values.mute || count > 1;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Simulator interrupted"));
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  let runtime: LocalRuntime | undefined;
  let playback: LivePlayback | undefined;
  try {
    if (!values["prepare-only"] && endpoint.health) {
      let health: Response;
      try { health = await fetch(endpoint.health, { redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) }); }
      catch { throw new Error("No running receptionist at this port. Start it yourself: bun run serve --dry-run"); }
      if (!health.ok) throw new Error(`Receptionist health check: HTTP ${health.status}`);
      requireDryRun(await health.json());
    }
    console.log(`Preparing ${count} live-data scenario(s) (seed ${seed})…`);
    const clinic = await clinicClient(await loadConfig());
    const prepared = [];
    // Prepare before opening sockets so clinic reads do not stagger call starts.
    for (const plan of callPlans(seed, count)) {
      controller.signal.throwIfAborted();
      const scenario = await generateScenario(clinic, {
        seed: plan.seed, kind: values.kind as Kind | undefined, language: values.language as Language | undefined,
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
      const scenarioPath = await saveLocal(`simulation-${plan.id}-scenario.json`, scenario);
      const audioDir = join(stateDir, `simulation-${plan.id}-audio`);
      if (!values["prepare-only"]) await mkdir(audioDir, { mode: 0o700 });
      prepared.push({ ...plan, scenario, scenarioPath, audioDir });
      console.log(`[${plan.index}/${count}] ${scenario.kind.toUpperCase()} / ${scenario.case.language}: ${scenario.case.summary}\nScenario: ${scenarioPath}`);
    }
    if (values["prepare-only"]) return;
    const model = callerModelConfig();
    runtime = new LocalRuntime(message => console.log(`[caller] ${message}`), {
      model, settings: { ...localSettings(), ttsWorkers: Math.min(count, 4) },
      transcription: transcriptionConfig({ ASR_PROVIDER: "openrouter", OPENROUTER_ASR_CONCURRENCY: String(Math.min(count, 20)) }),
    });
    const stopRuntime = () => runtime?.stop();
    controller.signal.addEventListener("abort", stopRuntime, { once: true });
    try {
      console.log(`Starting ${runtime.settings.ttsWorkers} caller-only Piper worker(s); OpenRouter chat/listening incurs API usage. Receptionist must already be running.`);
      await runtime.start();
      controller.signal.throwIfAborted();
      if (!muted) {
        playback = new LivePlayback(message => console.log(`[speakers] ${message}`));
        await playback.start();
        controller.signal.throwIfAborted();
      }
      const before = new Set(endpoint.health ? await reportFiles() : []);
      const inference = sharedCallerInference(runtime, controller.signal, runtime.settings.ttsWorkers);
      console.log(`Starting ${count} simultaneous call(s)${count > 1 ? "; speaker playback muted" : ""}…`);
      const batch = await runCallBatch(prepared, async ({ id, callId, index, scenario, scenarioPath, audioDir }) => {
        const log = (message: string) => console.log(`[${index}/${count} ${callId}] ${message}`);
        let audioIndex = 0;
        const started = performance.now();
        const call = await runSimulatedCall({ endpoint: endpoint.socket, token: endpoint.token, callId,
          item: scenario.case, inference, signal: controller.signal, monitor: playback?.push, progress: log,
          update: event => log(`${event.role === "caller" ? "Caller" : "Heard receptionist"}: ${event.text || "[unintelligible]"}`),
          saveAudio: async (role, audio) => {
            const paths: string[] = [];
            for (let offset = 0; offset < audio.length; offset += 240000) {
              const path = join(audioDir, `${String(++audioIndex).padStart(3, "0")}-${role}.wav`);
              await writeFile(path, muLawWav(audio.subarray(offset, offset + 240000).toString("base64")), { mode: 0o600 }); paths.push(path);
            }
            return paths;
          },
        }).catch((error): CallResult => ({ call_id: callId, elapsed_ms: Math.round(performance.now() - started), events: [],
          errors: [error instanceof Error ? error.message : String(error)] }));
        await playback?.stop();
        const partial = { scenario_path: scenarioPath, scenario, caller_model: model.model, call,
          target_mode: endpoint.health ? "local" : "external", platform_submission: endpoint.health ? false : "unknown",
          playback: { requested: !muted, warnings: playback?.warnings ?? [] },
          limitations: ["Adult existing-patient BOOK/CANCEL/RESCHEDULE only; public personas are lookup seeds, not full database sampling.",
            "Clean synthetic Piper voices; no background-noise, third-party privacy or barge-in assessment.",
            "Concurrent calls share bounded caller speech/ASR resources; caller-side queues affect observed load and timing.",
            "Caller uses playback marks or an audio-idle fallback for turn boundaries. Caller chat/ASR latency contributes to call duration.",
            "Seed repeats selection only against the same data/date; LLM wording and inference are nondeterministic."] };
        // Save before waiting for the server so an interrupted report lookup preserves the conversation.
        await saveLocal(`simulation-${id}.json`, partial);
        if (!endpoint.health) {
          const transport = externalCallStatus(call);
          const path = await saveLocal(`simulation-${id}.json`, { ...partial, transport,
            evaluation: { status: "not_graded", reason: "External target has no local receptionist report; action outcome and submission mode are unknown." } });
          log(`${transport.toUpperCase()} — ${Math.round(call.elapsed_ms / 1000)}s — actions NOT GRADED`);
          for (const error of call.errors) log(`  ${error}`);
          log(`Saved: ${path}\nAudio: ${audioDir}`);
          return { call_id: callId, status: transport, report_path: path, elapsed_ms: call.elapsed_ms };
        }
        const report = await waitForReport(callId, new Set(before), controller.signal);
        const evaluation = gradeCall(scenario, call, report);
        const path = await saveLocal(`simulation-${id}.json`, { ...partial, receptionist: report, evaluation });
        log(`${evaluation.status.toUpperCase()} — ${Math.round(call.elapsed_ms / 1000)}s\nExpected: ${JSON.stringify(scenario.case.expected.acceptable)}\nActual: ${JSON.stringify(report?.record ?? null)}`);
        for (const difference of evaluation.differences) log(`  ${difference}`);
        log(`Saved: ${path}\nAudio: ${audioDir}`);
        return { call_id: callId, status: evaluation.status, report_path: path, elapsed_ms: call.elapsed_ms };
      });
      if (count > 1) {
        const path = await saveLocal(`simulation-batch-${crypto.randomUUID()}.json`, {
          seed, target_mode: endpoint.health ? "local" : "external", ...batch,
        });
        console.log(`\nBatch: ${batch.succeeded}/${count} ${endpoint.health ? "passed" : "connected and closed (actions not graded)"}, ${batch.failed} failed/unverified\nSaved: ${path}`);
      }
      for (const result of batch.results) for (const error of result.errors ?? []) console.error(`[${result.call_id}] ${error}`);
      if (batch.failed || controller.signal.aborted) process.exitCode = 1;
    } finally { controller.signal.removeEventListener("abort", stopRuntime); }
  } finally {
    await playback?.stop();
    runtime?.stop(); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}

if (import.meta.main) simulate(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
