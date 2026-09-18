import { join } from "node:path";
import { type Key } from "node:readline";
import { actionRoutes, cases, documents, operations, problems, problemStatement, resolveSchema, type Action, type Endpoint, type ObjectValue, type PublicCase, type Schema } from "./data";
import { baseUrl, inputSchema, keyIdentity, parseField, PlatformClient, prepareRequest } from "./api";
import { evaluateBatch, parseResults, type ResultInput } from "./evaluate";
import { contractDiagnostics, labDescriptions, rankSites, readiness, resolveRelativeDate } from "./labs";
import { inspectTrace, probeEndpoint } from "./protocol";
import { loadConfig, readJson, saveConfig, saveLocal, stateDir, type Config } from "./storage";
import { detailViewport, Terminal, type TerminalPort, type View, wrap } from "./terminal";
import { isObject, nationalId, validNationalId, validate } from "./validation";
import { LocalRuntime } from "./voice/runtime";
import { clinicClient, DEFAULT_PLATFORM, environmentPlatform } from "./voice/platform";
import { resultFromRehearsal, runRehearsal, voiceSmoke } from "./voice/rehearsal";
import { type TraceEvent } from "./voice/agent";
import { runFreeConversation, type VoiceLanguage } from "./voice/free";
import { microphoneInput } from "./voice/microphone";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const tabs = ["Cases", "API", "Labs", "Results", "Docs", "Setup", "Voice"];
type Item = { id: string; label: string; detail: string; case?: PublicCase; endpoint?: Endpoint };
export class Workbench {
  private tab = 0;
  private selected = 0;
  private scroll = 0;
  private filter = "";
  private focus: "list" | "detail" = "list";
  private follow = false;
  private help = false;
  private sections = new Map<number, { selected: number; scroll: number; filter: string; focus: "list" | "detail"; detail?: string }>();
  private status = "Offline. No API requests until you explicitly run one.";
  private detailOverride?: string;
  private answers = false;
  private busy = false;
  private results: ResultInput[] = [];
  private config: Config = { origin: "", endpoint: "" };
  private terminal: TerminalPort;
  private voiceLog: string[] = [];
  private conversation: string[] = [];
  private voice: LocalRuntime;
  private voiceBusy = false;
  private runAbort?: AbortController;
  constructor(createTerminal: (view: () => View, onKey: (key: Key, text: string) => void) => TerminalPort = (view, onKey) => new Terminal(view, onKey)) {
    this.terminal = createTerminal(() => this.view(), (key, text) => this.handleKey(key, text));
    this.voice = new LocalRuntime(message => {
      this.voiceLog.push(message); this.voiceLog = this.voiceLog.slice(-80);
      this.status = message;
      if (this.voiceBusy) { this.detailOverride = this.voiceLog.slice(-18).join("\n"); this.scroll = 0; }
      this.terminal.draw();
    });
    this.terminal.abort.signal.addEventListener("abort", () => { this.runAbort?.abort(); this.voice.stop(); }, { once: true });
  }
  async start(localVoice = true) {
    this.config = await loadConfig();
    if (process.env.PLATFORM_API_KEY || process.env.PLATFORM_API_BASE_URL) this.config.origin = environmentPlatform().origin;
    if (!this.config.origin) this.config.origin = DEFAULT_PLATFORM;
    try { this.results = parseResults(await readJson(join(stateDir, "results.json"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.status = `Saved results not loaded: ${error instanceof Error ? error.message : error}`; }
    this.terminal.start();
    if (localVoice) { this.tab = 6; await this.task(() => this.setupVoice()); }
  }
  private caseDetail(item: PublicCase) {
    const problem = problems.find(p => p.id === item.problem_id)!;
    return [
      `${problem.number}. ${problem.name} / ${item.language.toUpperCase()}`, item.id,
      `Weight ${problem.weight} · archive ${item.reference_time}`, "",
      item.summary || item.persona.description, "", "CALLER", item.persona.name,
      ...item.persona.objectives.map(objective => `• ${objective}`), "",
      "PERSONA DATA (public fixture, not a live directory)", pretty(item.persona.data),
      "", `Audio: ${item.audio.background}; SNR: ${item.audio.signal_to_noise_db ?? "n/a"} dB`,
      "", "v runs an automated local voice rehearsal; m lets you play the caller by microphone. e enters a manual outcome; a reveals answers.",
      ...(this.answers ? ["", "ARCHIVED ACCEPTABLE OUTCOMES — not today's live oracle", pretty(item.expected)] : []),
      "", "PROBLEM REQUIREMENT", problemStatement(problem.number),
    ].join("\n");
  }
  private items(): Item[] {
    let items: Item[];
    if (this.tab === 0) items = problems.flatMap(problem => problem.cases.length
      ? problem.cases.map((item, i) => ({ id: item.id, label: `${String(problem.number).padStart(2, "0")}.${i + 1} ${item.language.toUpperCase()} ${problem.name.replace(/^The /, "")}`, detail: this.caseDetail(item), case: item }))
      : [{ id: problem.id, label: "02 Switchboard · 5 / 10 / 20", detail: problemStatement(2) + "\n\nOpen Labs > Probe an existing endpoint for a transport diagnostic. Real scored calls still require a voice pipeline." }]);
    else if (this.tab === 1) items = operations.map(endpoint => ({ id: endpoint.path, label: `${endpoint.method} ${endpoint.path.replace("/api/v1/", "")}`,
      detail: `${endpoint.method} ${endpoint.path}\n${endpoint.summary}\n\n${endpoint.description ?? ""}\n\n${pretty(endpoint.requestBody ? resolveSchema(endpoint.requestBody.content["application/json"].schema) : endpoint.parameters ?? [])}\n\nEnter: fill form and preview request. Only documented endpoints are available.`, endpoint }));
    else if (this.tab === 2) items = labDescriptions.map(lab => ({ id: lab.id, label: lab.title, detail: `${lab.title}\n\n${lab.text}\n\nEnter to run.` }));
    else if (this.tab === 3) {
      const report = evaluateBatch(this.results);
      items = [{ id: "summary", label: `Summary · ${report.attempted}/${report.total} attempted`, detail: this.reportText() },
        ...report.evaluations.map(row => ({ id: row.case_id, label: `${row.status.toUpperCase()} ${row.case_id}`, detail: pretty(row) }))];
    } else if (this.tab === 4) items = Object.entries(documents).map(([name, contents]) => ({ id: name, label: name, detail: contents }));
    else if (this.tab === 5) items = [
      { id: "origin", label: "Set platform API origin", detail: `API origin: ${this.config.origin || "not configured"}\n\nEnter the exact HTTPS API host supplied by the desk. No requests happen automatically. HTTP is accepted for localhost test servers only.\n\nEnter to configure.` },
      { id: "key", label: "API key · .env or Keychain", detail: "Set PLATFORM_API_KEY in your git-ignored .env and restart bun start. PLATFORM_API_BASE_URL defaults to https://hackspain.getprosperapp.com. The token is never displayed.\n\nAlternatively Enter stores a team key in macOS Keychain with masked input. A configured .env key takes precedence for its API origin." },
      { id: "endpoint", label: "Set external agent endpoint", detail: `Endpoint: ${this.config.endpoint || "not configured"}\n\nThis is for the external WebSocket transport probe, separate from the embedded local voice runner. Start that endpoint and tunnel yourself. Set the same ws(s)://host/path in dashboard Settings > Integration. The probe supports endpoints without custom auth headers.\n\nEnter to configure.` },
      { id: "readiness", label: "Runbook and remaining work", detail: readiness() },
      { id: "storage", label: "Local data and limitations", detail: `Files live under ${stateDir}\n\nConfig contains only API origin and endpoint. PLATFORM_API_KEY can be supplied through the git-ignored .env; alternatively use Keychain. Local reports contain clinic/persona data and transcripts, never keys. Temporary audio is deleted after each operation.\n\nVoice tests use real clinic reads and local final records. They do not initiate official runs or submit to Prosper. Streaming, background-noise playback, barge-in and concurrent voice inference remain separate live checks.\n\nSource: task/README.md lists provenance.` },
    ];
    else items = [
      { id: "status", label: `Local stack · ${this.voice.state}`, detail: `Qwen3.5 4B / Whisper small (MLX) / Piper en, es, ca\nState: ${this.voice.state}\n${this.voice.error}\n\n${this.voiceLog.join("\n")}\n\nEnter to prepare/retry setup. Initial downloads: several GB. Cached on later starts. Quit stops only this workbench's processes.` },
      { id: "free", label: "Free conversation · microphone or text", detail: "Talk to the receptionist about anything you want to test. No public case, caller script, expected answer, or score. Choose English, Spanish or Catalan.\n\nUses the current connection time and real Prosper clinic reads. Proposed actions stay local. Conversations have no scripted turn count or three-minute deadline; individual model/audio operations still time out if stuck.\n\nEnter starts, then Space starts recording and Space again sends your reply. t lets you type; Esc ends the conversation. The receptionist can also finish once your final intents are confirmed. A separate transcript and action report is saved under .workbench/free-*.json.\n\nRequires PLATFORM_API_KEY. Speech is turn-based; streaming and interruption handling are not implemented." },
      { id: "smoke", label: "Run speech + model smoke tests", detail: "Synthesize and transcribe English, Spanish and Catalan sentences through 8 kHz mu-law, report word error rates and timings, and check local model output. No clinic key or microphone needed.\n\nEnter to run." },
      { id: "all", label: "Rehearse all 73 public cases", detail: "Run the local caller and receptionist sequentially on every public case, including unopened problems. Real Prosper clinic reads require PLATFORM_API_KEY in .env. Final action records remain local.\n\nUp to three minutes per case; a full run can take hours. Results/checkpoints are saved after every case. c cancels a running test; Ctrl-C exits.\n\nUse Cases > v for one case or Cases > m to speak as that caller.\n\nAudio is turn-based, uses clean synthesized voices, and applies 8 kHz mu-law conversion. This does not reproduce the official noise beds, timing, caller model or barge-in." },
      { id: "instructions", label: "Microphone & test instructions", detail: "1. Put PLATFORM_API_KEY in .env and restart bun start. API host defaults to https://hackspain.getprosperapp.com.\n2. Start runs the dependency/model setup automatically.\n3. Run the speech smoke check here.\n4. Choose a public case in Cases. Press v for an automated caller, or m for a microphone conversation.\n5. Microphone mode reads the case objectives, plays the receptionist, then waits for Space to start recording and Space again to send (up to 30 seconds). Esc discards a take. macOS may request microphone permission. Press t at the caller prompt to send text instead.\n6. Inspect Results and voice report files in .workbench.\n\nThe simulated call uses the archived reference time, not today's clock. The local caller can deviate from the official script; inspect its transcript. No real appointments are booked. Native voice performance is only measured when you run this on your machine." },
      { id: "platform", label: "Platform calls · server setup", detail: "REAL PROSPER TEST CALLS\n\n1. Quit this voice-enabled TUI so only one copy of the models runs.\n2. In a terminal: bun run serve\n3. Wait for Ready: ws://127.0.0.1:7860/ws\n4. In another terminal: ngrok http 7860\n5. Set Prosper Settings > Integration > Endpoint to wss://<your-public-host>/ws.\n6. Start one public practice Call from the Problems page.\n\nserve submits real resolutions to /api/v1/submit/* with the incoming start.callSid. Use bun run serve --dry-run for transport diagnostics without submissions. No Twilio account is needed.\n\nOptional authentication: set VOICE_SERVER_TOKEN, restart serve, and put Authorization: Bearer <same secret> in the dashboard Headers.\n\nPer-call reports: .workbench/platform-*.json. Read README.md for settings and limits; bun run serve --help is safe and does not start services.\n\n20 simulated sessions pass isolation tests; real-time model performance and live scoring still require practice calls. This screen does not launch a server or tunnel." },
    ];
    const filter = this.filter.toLowerCase();
    return filter ? items.filter(item => `${item.label}\n${item.id}\n${item.detail}`.toLowerCase().includes(filter)) : items;
  }
  private reportText(): string {
    const report = evaluateBatch(this.results);
    return [report.label, "", `${report.passed} pass / ${report.attempted} attempted / ${report.total} total`,
      `${report.needs_review} need review; ${report.diagnostic_points.toFixed(2)} / 49 diagnostic points`,
      `Archive date: ${report.reference_time}. Unattempted cases earn zero.`, "",
      ...report.breakdown.map(row => `${row.problem}: ${row.passed}/${row.total} pass · ${row.attempted} attempted · ${row.points.toFixed(2)} pts`),
      "", "i imports one batch, replacing the current run. x exports a timestamped report. Separate exports let you compare repeated runs; they do not overwrite history.",
      "No automated speech/language assessment. Privacy scan is limited; review audio. Different date anchors need review. Manual outcomes measure record correctness only.",
    ].join("\n");
  }
  private view(): View {
    const items = this.items();
    this.selected = Math.max(0, Math.min(this.selected, items.length - 1));
    return { tab: this.tab, tabs, items: items.map(i => i.label), selected: this.selected,
      detail: this.help ? this.helpText() : this.detailOverride ?? items[this.selected]?.detail ?? "No matches. Press / to change the filter or Esc to clear it.",
      focus: this.focus, fullscreen: this.busy || this.help, follow: this.follow,
      scroll: this.scroll, status: this.status, filter: this.filter,
      footer: this.busy ? "Working… c cancels a voice test; Ctrl-C quits and stops local processes." : this.tab === 0 ? "Enter details · m microphone · v rehearse · f free chat · e outcome · a answers" : "Enter open/run · f free chat · i import · x export",
      mode: this.voice.state === "ready" ? "LOCAL VOICE READY" : this.config.origin ? "API configured" : "OFFLINE" };
  }
  private show(value: unknown, status = "Done") { this.focus = "detail"; this.follow = false; this.detailOverride = typeof value === "string" ? value : pretty(value); this.scroll = 0; this.status = status; this.terminal.draw(); }
  private reset() { this.scroll = 0; this.detailOverride = undefined; }
  private helpText() {
    return ["KEYBOARD SHORTCUTS", "", "NAVIGATION", "1–7 / Tab / Shift-Tab   Change section (position and search are preserved)",
      "← / →                  Focus list / details", "↑↓ or j/k              Move in the focused pane", "Enter                  Open details or run the selected action",
      "PgUp / PgDn            Scroll details, including during voice runs", "Home / End             First / last item or detail line; End resumes live follow",
      "/                      Search this section", "Esc                    Close help/details, then clear search", "?                      Show / hide this help", "q / Ctrl-C             Quit", "",
      "CASES & VOICE", "f                      Free conversation", "m / v                  Microphone / automated rehearsal", "e / a                  Enter outcome / reveal acceptable answers",
      "c                      Cancel a running voice test", "Space                  Start / send a microphone reply (30s maximum)", "t / Esc                Type instead / end call; Esc while recording discards", "", "RESULTS", "i / x                  Import results / export report", "",
      "INPUT", "←→ / Home / End        Edit within a field", "Ctrl-U                 Clear input", "Enter / Esc            Accept / cancel"].join("\n");
  }
  private handleKey(key: Key, text: string) {
    if (text === "q") { this.terminal.close(); return; }
    if (text === "c" && this.runAbort) { this.runAbort.abort(); return; }
    if (text === "?") { this.help = !this.help; this.scroll = 0; this.follow = false; this.terminal.draw(); return; }
    const scrollKey = ["pageup", "pagedown", "home", "end"].includes(key.name ?? "");
    const direction = ["up", "down"].includes(key.name ?? "") || ["j", "k"].includes(text);
    if (scrollKey && (this.focus === "detail" || this.busy || this.help || key.name?.startsWith("page")) || direction && (this.focus === "detail" || this.busy || this.help)) {
      const viewport = detailViewport(process.stdout.columns || 100, process.stdout.rows || 30, this.busy || this.help);
      const max = Math.max(0, wrap(this.view().detail, viewport.width).length - viewport.height);
      const current = this.follow ? max : this.scroll;
      const delta = key.name === "pageup" ? -viewport.height : key.name === "pagedown" ? viewport.height : key.name === "up" || text === "k" ? -1 : 1;
      this.scroll = key.name === "home" ? 0 : key.name === "end" ? max : Math.min(max, Math.max(0, current + delta));
      this.focus = "detail";
      this.follow = !!this.runAbort && key.name === "end";
      this.terminal.draw(); return;
    }
    if (this.help) { if (key.name === "escape") { this.help = false; this.scroll = 0; } this.terminal.draw(); return; }
    if (this.busy) return;
    if (key.name === "tab" || /^[1-7]$/.test(text ?? "")) {
      this.sections.set(this.tab, { selected: this.selected, scroll: this.scroll, filter: this.filter, focus: this.focus, detail: this.detailOverride });
      this.tab = key.name === "tab" ? (this.tab + (key.shift ? tabs.length - 1 : 1)) % tabs.length : Number(text) - 1;
      const saved = this.sections.get(this.tab);
      this.selected = saved?.selected ?? 0; this.scroll = saved?.scroll ?? 0; this.filter = saved?.filter ?? "";
      this.focus = saved?.focus ?? "list"; this.detailOverride = saved?.detail; this.follow = false;
    } else if (direction || key.name === "home" || key.name === "end") {
      this.selected = key.name === "home" ? 0 : key.name === "end" ? this.items().length - 1 : this.selected + (key.name === "up" || text === "k" ? -1 : 1); this.reset();
    } else if (key.name === "right") { this.focus = "detail"; }
    else if (key.name === "left") { this.focus = "list"; }
    else if (key.name === "escape") {
      if (this.detailOverride) { this.reset(); this.focus = "list"; }
      else if (this.focus === "detail") this.focus = "list";
      else { this.filter = ""; this.reset(); }
    }
    else if (text === "a" && this.tab === 0) { this.answers = !this.answers; this.reset(); }
    else if (text === "/") void this.task(async () => { const query = await this.terminal.ask("Search"); if (query !== null) { this.filter = query; this.selected = 0; this.focus = "list"; this.reset(); } });
    else if (text === "i") void this.task(() => this.importResults());
    else if (text === "x") void this.task(async () => this.show(await saveLocal(`report-${Date.now()}.json`, evaluateBatch(this.results)), "Report exported"));
    else if (text === "e" && this.tab === 0) void this.task(() => this.enterOutcome());
    else if (text === "f") void this.task(() => this.freeConversation());
    else if (["v", "m"].includes(text) && this.tab === 0) {
      const item = this.items()[this.selected]?.case;
      if (item) void this.task(() => this.rehearse([item], text === "m"));
    }
    else if (key.name === "return") void this.task(() => this.activate());
    this.terminal.draw();
  }
  private async task(fn: () => Promise<unknown>) {
    this.busy = true;
    try { await fn(); }
    catch (error) { this.show(error instanceof Error ? error.message : String(error), "Could not complete action; no automatic retry."); }
    finally { this.busy = false; this.terminal.draw(); }
  }
  private async fields(properties: Record<string, Schema>, required: string[], omit: string[] = []): Promise<ObjectValue | null> {
    const values: ObjectValue = {};
    for (const [name, schema] of Object.entries(properties)) {
      if (omit.includes(name)) continue;
      const input = inputSchema(schema);
      while (true) {
        this.show(`${name}${required.includes(name) ? " (required)" : " (optional; blank to skip)"}\n\n${schema.description ?? input.description ?? ""}\n\n${input.enum ? "Choices: " + input.enum.join(", ") : input.type === "array" ? "Comma-separated values" : "Type: " + input.type}\n\n${pretty(values)}\n\nEnter your actual observed values. No expected answer is copied into this form.`, "Esc cancels the form. Ctrl-U clears input.");
        const text = await this.terminal.ask(name);
        if (text === null) return null;
        if (!text.trim() && !required.includes(name)) break;
        const parsed = parseField(text.trim(), schema);
        const errors = validate(parsed, schema, name);
        if (errors.length) { this.show(errors.join("\n"), "Invalid value"); await this.terminal.ask("Enter to try again"); continue; }
        values[name] = parsed; break;
      }
    }
    return values;
  }
  private async enterOutcome() {
    const item = this.items()[this.selected]?.case;
    if (!item) return;
    const actions: Action[] = [];
    const verbs = Object.keys(actionRoutes);
    do {
      this.show(verbs.map((verb, i) => `${i + 1}. ${verb}`).join("\n") + `\n\nCase: ${item.id}\n${pretty({ actions })}`, "Compose the final record; all intents must be included.");
      const choice = await this.terminal.ask("Action 1–6");
      if (choice === null) return;
      const verb = verbs[Number(choice) - 1];
      if (!verb) throw new Error("Choose an action from 1 to 6");
      const endpoint = operations.find(o => o.path === `/api/v1/submit/${actionRoutes[verb]}`)!;
      const schema = resolveSchema(endpoint.requestBody!.content["application/json"].schema);
      const values = await this.fields(schema.properties!, schema.required!, ["call_id"]);
      if (!values) return;
      actions.push(verb === "REGISTER" ? { action: verb, new_patient: values } : { action: verb, ...values });
    } while (actions.length < 6 && (await this.terminal.ask("Add another action? y/N"))?.toLowerCase() === "y");
    this.show("Optional transcript JSON file: [{\"role\":\"agent\",\"text\":\"…\"},{\"role\":\"caller\",\"text\":\"…\"}]\n\nProtected-data cases without agent transcript evidence remain unverified.");
    const transcriptPath = await this.terminal.ask("Transcript file (blank to skip)");
    if (transcriptPath === null) return;
    const referenceTime = await this.terminal.ask("Actual call timestamp (blank = archived fixture)");
    if (referenceTime === null) return;
    const [row] = parseResults([{ case_id: item.id, record: { actions },
      ...(transcriptPath.trim() ? { transcript: await readJson(transcriptPath.trim()) } : {}),
      ...(referenceTime.trim() ? { reference_time: referenceTime.trim() } : {}) }]);
    this.results = [...this.results.filter(r => r.case_id !== item.id), row!];
    await saveLocal("results.json", this.results);
    this.show(evaluateBatch([row!]).evaluations[0], "Saved local result. Nothing submitted to the platform.");
  }
  private async importResults() {
    const path = await this.terminal.ask("Results JSON file");
    if (!path) return;
    const results = parseResults(await readJson(path.trim()));
    await saveLocal("results.json", results);
    this.results = results;
    this.tab = 3; this.selected = 0; this.filter = ""; this.reset();
    this.status = `Imported ${results.length} results as the current run.`;
  }
  private async api(endpoint: Endpoint) {
    const body = endpoint.requestBody && resolveSchema(endpoint.requestBody.content["application/json"].schema);
    const properties = body?.properties ?? Object.fromEntries((endpoint.parameters ?? []).map(p => [p.name, p.schema]));
    const required = body?.required ?? (endpoint.parameters ?? []).filter(p => p.required).map(p => p.name);
    const fields = await this.fields(properties, required);
    if (!fields) return;
    const request = prepareRequest(endpoint, fields);
    this.show(`${this.config.origin || "API origin not set"}\n${pretty(request)}\n\n${request.method === "POST" ? "One action will be added to a real call. Use the exact start.callSid; close +30s deadline. A 200 is receipt, not a pass." : "Read-only platform request."}`, "Request preview");
    if (!this.config.origin) { this.status = "Preview only. Set API origin and key in Setup to send."; return; }
    const answer = await this.terminal.ask(request.method === "POST" ? "Type submit to send this action" : "Send request? y/N");
    if (answer !== (request.method === "POST" ? "submit" : "y")) return;
    this.status = "Request in flight… (15s timeout)"; this.terminal.draw();
    const environment = environmentPlatform();
    const key = endpoint.path.endsWith("/health") ? null : environment.key && environment.origin === this.config.origin
      ? environment.key : await Bun.secrets.get(keyIdentity(this.config.origin));
    const response = await new PlatformClient(this.config.origin, key).request(request, this.terminal.abort.signal);
    this.show(response, `${response.status} · ${response.elapsed_ms} ms · response kept in memory only`);
  }
  private async activate() {
    const item = this.items()[this.selected];
    if (!item) return;
    if (item.case || this.tab === 3 || this.tab === 4) { this.focus = "detail"; return; }
    if (item.endpoint) return this.api(item.endpoint);
    if (this.tab === 2) return this.lab(item.id);
    if (this.tab === 6) {
      if (item.id === "status") return this.setupVoice();
      if (item.id === "free") return this.freeConversation();
      if (item.id === "smoke") return this.smokeVoice();
      if (item.id === "all") return this.rehearse(cases);
      this.focus = "detail"; return;
    }
    if (this.tab !== 5) return;
    if (item.id === "origin") {
      const value = await this.terminal.ask("API origin", this.config.origin);
      if (value === null) return;
      this.config.origin = value.trim() ? baseUrl(value.trim()) : "";
    } else if (item.id === "key") {
      if (!this.config.origin) throw new Error("Set the API origin first; keys are scoped to it.");
      const value = await this.terminal.ask("Team API key (masked)", "", true);
      if (!value) return;
      if (/\s/.test(value.trim())) throw new Error("API key must not contain whitespace");
      await Bun.secrets.set({ ...keyIdentity(this.config.origin), value: value.trim() });
      this.status = "Team key saved in macOS Keychain."; return;
    } else if (item.id === "endpoint") {
      const value = await this.terminal.ask("Existing ws(s) endpoint", this.config.endpoint);
      if (value === null) return;
      if (value) {
        const url = new URL(value);
        if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use ws(s)://host/path without credentials, query or fragment");
      }
      this.config.endpoint = value;
    } else return;
    await saveConfig(this.config); this.reset(); this.status = "Configuration saved. No network request made.";
  }
  private async setupVoice() {
    this.voiceBusy = true;
    this.show("Preparing local voice. First launch installs missing tools and downloads several GB.\nThe cached models will be reused. Ctrl-C cancels and stops owned processes.", "Starting local setup…");
    try { await this.voice.start(); }
    finally { this.voiceBusy = false; }
    this.show("Local speech and reasoning models are ready.\n\nPress f for a free conversation without a script. Or run Speech + model smoke tests, or select a case and press v (automated) / m (microphone).\n\nClinic key comes from PLATFORM_API_KEY in .env; no clinic requests were made by setup.", "Local voice ready");
  }
  private voiceEvent = (event: TraceEvent) => {
    this.voiceLog.push(`${event.stage}${event.elapsed_ms ? ` ${event.elapsed_ms}ms` : ""}: ${event.detail}`);
    this.voiceLog = this.voiceLog.slice(-80);
    if (event.stage === "agent" || event.stage === "caller") {
      this.conversation.push(`${event.stage === "agent" ? "RECEPTIONIST" : "YOU"}\n${event.detail}`);
    }
    this.detailOverride = this.conversation.length ? this.conversation.join("\n\n") : this.voiceLog.join("\n");
    const stages: Record<string, string> = { agent: "Preparing receptionist audio…", caller: "Receptionist is thinking…", playback: "Receptionist is speaking…", synthesis: "Checking speech…", recognition: "Speech recognized", tool: "Looking up clinic information…", reasoning: "Receptionist response ready" };
    this.status = `${stages[event.stage] ?? event.stage}${event.elapsed_ms ? ` · ${event.elapsed_ms} ms` : ""} · c cancels`;
    this.focus = "detail";
    this.terminal.draw();
  };
  private async smokeVoice() {
    this.conversation = []; this.follow = true;
    await this.voice.start();
    this.runAbort = new AbortController();
    const signal = AbortSignal.any([this.runAbort.signal, this.terminal.abort.signal]);
    try { this.show(await voiceSmoke(this.voice, signal, this.voiceEvent), "Local smoke test complete"); }
    finally { this.runAbort = undefined; }
  }
  private async callerInput(signal: AbortSignal, language: string): Promise<string | null> {
    return microphoneInput(this.terminal, this.voice, signal, language, message => {
      this.status = message; this.terminal.draw();
    });
  }
  private async freeConversation() {
    this.show("Free conversation — say what you want to test.\n\nChoose a language, then Space starts recording and Space again sends your reply; t lets you type. Esc ends the conversation.\n\nUses today's connection time and real Prosper clinic data. Actions and transcripts stay local; this does not change case scores.", "Free conversation");
    const choice = await this.terminal.ask("Language: en / es / ca", "en");
    if (choice === null) return;
    const language = choice.trim().toLowerCase();
    if (!["en", "es", "ca"].includes(language)) throw new Error("Choose en, es or ca for the conversation language.");
    const clinic = await clinicClient(this.config);
    await this.voice.start();
    this.runAbort = new AbortController();
    const signal = AbortSignal.any([this.runAbort.signal, this.terminal.abort.signal]);
    try {
      this.status = "Connecting to clinic…"; this.terminal.draw();
      const health = await clinic.request({ method: "GET", path: "/api/v1/clinic" }, signal);
      if (health.status !== 200) throw new Error(`${health.status}: ${health.meaning}`);
      this.voiceLog = ["Free conversation · no script or case score"];
      this.conversation = []; this.follow = true;
      this.detailOverride = "FREE CONVERSATION\n\nWaiting for the receptionist…";
      this.status = "Receptionist is thinking…"; this.terminal.draw();
      const report = await runFreeConversation(this.voice, clinic, language as VoiceLanguage, signal, this.voiceEvent, callSignal => this.callerInput(callSignal, language));
      const saved = await saveLocal(`free-${report.session_id}.json`, report);
      this.show([
        `FREE CONVERSATION · ${report.status.toUpperCase()}`, `${report.language.toUpperCase()} · ${Math.round(report.elapsed_ms / 1000)}s`,
        ...(report.error ? ["", `Error: ${report.error}`] : []),
        "", "TEST RESOLUTION (simulated; nothing submitted)", report.record ? pretty(report.record) : "No valid resolution captured.",
        "", "TRANSCRIPT", this.conversation.join("\n\n"),
        "", "SUBMISSION PREVIEW (call_id must be the real start.callSid)", pretty(report.submission_preview), "", `Full report: ${saved}`,
      ].join("\n"), `Conversation ${report.status} · f starts a new call`);
    } finally { this.runAbort = undefined; }
  }
  private async rehearse(selected: PublicCase[], microphone = false) {
    const clinic = await clinicClient(this.config);
    await this.voice.start();
    this.runAbort = new AbortController();
    const signal = AbortSignal.any([this.runAbort.signal, this.terminal.abort.signal]);
    const batch = `voice-${Date.now()}`;
    const batchResults: ResultInput[] = [];
    try {
      // Fail before looping over 73 cases if credentials are invalid or revoked.
      this.status = "Connecting to clinic…"; this.terminal.draw();
      const health = await clinic.request({ method: "GET", path: "/api/v1/clinic" }, signal);
      if (health.status !== 200) throw new Error(`${health.status}: ${health.meaning}`);
      for (const [index, item] of selected.entries()) {
        if (signal.aborted) break;
        this.voiceLog = [`${index + 1}/${selected.length}: ${item.id}`, `Simulated connection: ${item.reference_time}`];
        if (microphone) {
          this.show(this.caseDetail(item), "Read your caller objectives before starting.");
          if (await this.terminal.ask("Enter to start; Esc cancels") === null) break;
        }
        this.conversation = []; this.follow = true;
        this.detailOverride = `${item.id}\n\nWaiting for the receptionist…`;
        this.status = "Receptionist is thinking…"; this.terminal.draw();
        const report = await runRehearsal(this.voice, clinic, item, signal, this.voiceEvent, microphone ? (_answer, callSignal) => this.callerInput(callSignal, item.language) : undefined);
        const row = resultFromRehearsal(report);
        batchResults.push(row);
        this.results = [...this.results.filter(r => r.case_id !== row.case_id), row];
        await saveLocal(`${batch}-${index + 1}.json`, report);
        await saveLocal(`${batch}-results.json`, batchResults);
        await saveLocal("results.json", this.results);
        this.show([
          `${item.id} · ${report.evaluation.status.toUpperCase()}`, ...(report.error ? [`Error: ${report.error}`] : []),
          "", "TEST RESOLUTION (simulated; nothing submitted)", pretty(report.record),
          "", "COMPARISON", ...report.evaluation.differences, "", "TRANSCRIPT", this.conversation.join("\n\n"),
          "", "SUBMISSION PREVIEW (call_id must be the real start.callSid)", pretty(report.submission_preview),
          "", `Full report: ${stateDir}/${batch}-${index + 1}.json`,
        ].join("\n"), `${index + 1}/${selected.length}: ${report.evaluation.status} · see Results for comparison`);
        if (this.voice.state !== "ready") break; // Failed worker needs setup retry; do not mark the remaining cases as tested.
      }
      if (selected.length > 1 || !batchResults.length) this.show({ ...evaluateBatch(batchResults), saved: `${stateDir}/${batch}-*.json`, cancelled: signal.aborted }, "Voice rehearsal finished; actions stayed local.");
    } finally { this.runAbort = undefined; }
  }
  private async lab(id: string) {
    if (id === "contract") this.show(contractDiagnostics());
    else if (id === "readiness") this.show(readiness());
    else if (id === "trace") {
      const path = await this.terminal.ask("Inbound trace JSON file");
      if (path) this.show(inspectTrace(await readJson(path.trim())));
    } else if (id === "burst") {
      if (!this.config.endpoint) throw new Error("Configure an already-running endpoint in Setup first.");
      const count = await this.terminal.ask("Concurrent sockets: 1, 5, 10 or 20", "1");
      if (count === null) return;
      this.show(`Endpoint: ${this.config.endpoint}\nSockets: ${count}\n\n${labDescriptions.find(l => l.id === id)!.text}`, "Transport probe preview");
      if (await this.terminal.ask("Type probe to connect") !== "probe") return;
      this.status = "Probing existing endpoint for 5 seconds…"; this.terminal.draw();
      this.show(await probeEndpoint(this.config.endpoint, Number(count), this.terminal.abort.signal));
    } else if (id === "date") {
      const reference = await this.terminal.ask("Call connected at", cases[0]!.reference_time);
      if (reference === null) return;
      const phrase = await this.terminal.ask("Relative phrase", "this coming Thursday");
      if (phrase !== null) this.show(resolveRelativeDate(phrase, reference));
    } else if (id === "dni") {
      const value = await this.terminal.ask("Full DNI / NIE");
      if (value !== null) this.show({ normalized: nationalId(value), valid: validNationalId(value) });
    } else if (id === "nearest") {
      const lat = await this.terminal.ask("Origin latitude"); if (!lat) return;
      const lon = await this.terminal.ask("Origin longitude"); if (!lon) return;
      const path = await this.terminal.ask("Eligible sites JSON file"); if (!path) return;
      const sites = await readJson(path);
      if (!Array.isArray(sites) || sites.some(s => !isObject(s))) throw new Error("Expected an array of sites");
      this.show(rankSites(Number(lat), Number(lon), sites));
    }
  }
}
