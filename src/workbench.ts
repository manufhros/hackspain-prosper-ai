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

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const tabs = ["Cases", "API", "Labs", "Results", "Docs", "Setup"];
type Item = { id: string; label: string; detail: string; case?: PublicCase; endpoint?: Endpoint };
export class Workbench {
  private tab = 0;
  private selected = 0;
  private scroll = 0;
  private filter = "";
  private status = "Offline. No API requests until you explicitly run one.";
  private detailOverride?: string;
  private answers = false;
  private busy = false;
  private results: ResultInput[] = [];
  private config: Config = { origin: "", endpoint: "" };
  private terminal: TerminalPort;
  constructor(createTerminal: (view: () => View, onKey: (key: Key, text: string) => void) => TerminalPort = (view, onKey) => new Terminal(view, onKey)) {
    this.terminal = createTerminal(() => this.view(), (key, text) => this.handleKey(key, text));
  }
  async start() {
    this.config = await loadConfig();
    try { this.results = parseResults(await readJson(join(stateDir, "results.json"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.status = `Saved results not loaded: ${error instanceof Error ? error.message : error}`; }
    this.terminal.start();
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
      "", "Press e to enter an outcome; i to import actual results; a to reveal archived answers.",
      ...(this.answers ? ["", "ARCHIVED ACCEPTABLE OUTCOMES — not today's live oracle", pretty(item.expected)] : []),
      "", "PROBLEM REQUIREMENT", problemStatement(problem.number),
    ].join("\n");
  }
  private items(): Item[] {
    let items: Item[];
    if (this.tab === 0) items = problems.flatMap(problem => problem.cases.length
      ? problem.cases.map((item, i) => ({ id: item.id, label: `${String(problem.number).padStart(2, "0")} ${problem.name.replace(/^The /, "")} ${i + 1}`, detail: this.caseDetail(item), case: item }))
      : [{ id: problem.id, label: "02 Switchboard · 5 / 10 / 20", detail: problemStatement(2) + "\n\nOpen Labs > Probe an existing endpoint for a transport diagnostic. Real scored calls still require a voice pipeline." }]);
    else if (this.tab === 1) items = operations.map(endpoint => ({ id: endpoint.path, label: `${endpoint.method} ${endpoint.path.replace("/api/v1/", "")}`,
      detail: `${endpoint.method} ${endpoint.path}\n${endpoint.summary}\n\n${endpoint.description ?? ""}\n\n${pretty(endpoint.requestBody ? resolveSchema(endpoint.requestBody.content["application/json"].schema) : endpoint.parameters ?? [])}\n\nEnter: fill form and preview request. Only documented endpoints are available.`, endpoint }));
    else if (this.tab === 2) items = labDescriptions.map(lab => ({ id: lab.id, label: lab.title, detail: `${lab.title}\n\n${lab.text}\n\nEnter to run.` }));
    else if (this.tab === 3) {
      const report = evaluateBatch(this.results);
      items = [{ id: "summary", label: `Summary · ${report.attempted}/${report.total} attempted`, detail: this.reportText() },
        ...report.evaluations.map(row => ({ id: row.case_id, label: `${row.status.toUpperCase()} ${row.case_id}`, detail: pretty(row) }))];
    } else if (this.tab === 4) items = Object.entries(documents).map(([name, contents]) => ({ id: name, label: name, detail: contents }));
    else items = [
      { id: "origin", label: "Set platform API origin", detail: `API origin: ${this.config.origin || "not configured"}\n\nEnter the exact HTTPS API host supplied by the desk. No requests happen automatically. HTTP is accepted for localhost test servers only.\n\nEnter to configure.` },
      { id: "key", label: "Store team key in Keychain", detail: "Enter the pk-… team key using masked input. Stored with Bun.secrets in macOS Keychain, scoped to the API origin. No plaintext .env file. The key is not read until an API request.\n\nEnter to save or replace." },
      { id: "endpoint", label: "Set existing agent endpoint", detail: `Endpoint: ${this.config.endpoint || "not configured"}\n\nUser starts the voice agent and tunnel. This workbench starts no servers. Set the same ws(s)://host/path in dashboard Settings > Integration. The transport probe currently supports endpoints without custom auth headers.\n\nEnter to configure.` },
      { id: "readiness", label: "Runbook and remaining work", detail: readiness() },
      { id: "storage", label: "Local data and limitations", detail: `Files live under ${stateDir}\n\nConfig contains only API origin and endpoint. Local results and reports may contain clinic/persona data; ignored by Git, directory 0700, files 0600. No request bodies, keys or API responses are logged to disk automatically.\n\nNo voice provider selected. No official runs initiated by this tool. Model quality, noise, interruption, actual 20-call performance, and jury criteria still need live rehearsal.\n\nSource: task/README.md lists provenance and known documentation discrepancies.` },
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
      detail: this.detailOverride ?? items[this.selected]?.detail ?? "No matches. Press / to change the filter or Esc to clear it.",
      scroll: this.scroll, status: this.status, filter: this.filter,
      footer: this.busy ? "Working… Ctrl-C exits and cancels active requests." : " Enter run/open   e enter outcome   a answers   i import results   x export report",
      mode: this.config.origin ? "API configured / explicit requests" : "OFFLINE" };
  }
  private show(value: unknown, status = "Done") { this.detailOverride = typeof value === "string" ? value : pretty(value); this.scroll = 0; this.status = status; this.terminal.draw(); }
  private reset() { this.scroll = 0; this.detailOverride = undefined; }
  private handleKey(key: Key, text: string) {
    if (text === "q" && !this.busy) { this.terminal.close(); return; }
    if (this.busy) return;
    if (key.name === "tab" || /^[1-6]$/.test(text ?? "")) {
      this.tab = key.name === "tab" ? (this.tab + (key.shift ? 5 : 1)) % tabs.length : Number(text) - 1;
      this.selected = 0; this.filter = ""; this.reset();
    } else if (["up", "down"].includes(key.name ?? "") || ["j", "k"].includes(text)) {
      this.selected += key.name === "up" || text === "k" ? -1 : 1; this.reset();
    } else if (key.name === "pagedown" || key.name === "pageup") {
      const page = Math.max(1, (process.stdout.rows || 30) - 8);
      const viewport = detailViewport(process.stdout.columns || 100, process.stdout.rows || 30);
      const max = Math.max(0, wrap(this.view().detail, viewport.width).length - viewport.height);
      this.scroll = Math.min(max, Math.max(0, this.scroll + (key.name === "pageup" ? -page : page)));
    } else if (key.name === "escape") { this.filter = ""; this.reset(); }
    else if (text === "a" && this.tab === 0) { this.answers = !this.answers; this.reset(); }
    else if (text === "/") void this.task(async () => { const query = await this.terminal.ask("Search"); if (query !== null) { this.filter = query; this.selected = 0; this.reset(); } });
    else if (text === "i") void this.task(() => this.importResults());
    else if (text === "x") void this.task(async () => this.show(await saveLocal(`report-${Date.now()}.json`, evaluateBatch(this.results)), "Report exported"));
    else if (text === "e" && this.tab === 0) void this.task(() => this.enterOutcome());
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
    const key = endpoint.path.endsWith("/health") ? null : await Bun.secrets.get(keyIdentity(this.config.origin));
    const response = await new PlatformClient(this.config.origin, key).request(request, this.terminal.abort.signal);
    this.show(response, `${response.status} · ${response.elapsed_ms} ms · response kept in memory only`);
  }
  private async activate() {
    const item = this.items()[this.selected];
    if (!item) return;
    if (item.case) return this.enterOutcome();
    if (item.endpoint) return this.api(item.endpoint);
    if (this.tab === 2) return this.lab(item.id);
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
