import { mkdir, chmod, rename, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import { root, type ObjectValue } from "../data";
import { stateDir } from "../storage";
import { isObject } from "../validation";
import { assets, MODEL, type Asset } from "./assets";
import { childEnvironment, modelConfig, openRouterKey, runtimeExecutables } from "./model";
import { OpenRouterChat } from "./openrouter";

export interface Message { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: ToolCall[]; tool_name?: string; tool_call_id?: string; reasoning_details?: unknown[] }
export interface ToolCall { id?: string; arguments_text?: string; function: { name: string; arguments: ObjectValue } }
export interface ChatReply { message: Message; elapsed_ms: number }
export interface AudioReply { text?: string; payload?: string; file?: string; language?: string; duration_ms?: number; elapsed_ms: number }
export interface Inference {
  chat(messages: Message[], tools: unknown[], signal: AbortSignal, format?: unknown): Promise<ChatReply>;
  audio(operation: string, fields: ObjectValue, signal: AbortSignal): Promise<AudioReply>;
  removeAudio(file: string): Promise<void>;
}
export const voiceDir = join(stateDir, "voice");

export function installationCommands(uv: string, python: string, directory: string): string[][] {
  return [
    [uv, "venv", "--allow-existing", "--python", "3.12", join(directory, "venv")],
    [uv, "pip", "sync", "--python", python, join(root, "local-voice/requirements.txt")],
  ];
}
export function killOwned(pid: number, kill = process.kill): void {
  try { kill(-pid, "SIGTERM"); } catch { /* Already exited. Every process here is its own group. */ }
}
async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("Cannot allocate local port")); return; }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
export async function streamLines(stream: ReadableStream<Uint8Array>, consume: (line: string) => void) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line.trim()) consume(line);
    }
    if (buffer.length > 2 * 1024 * 1024) throw new Error("Local process emitted an oversized line");
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
}
export class LocalRuntime implements Inference {
  state: "idle" | "installing" | "ready" | "error" | "stopped" = "idle";
  error = "";
  private children = new Set<ReturnType<typeof Bun.spawn>>();
  private stopSignal = new AbortController();
  private worker?: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  private llm?: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  private origin = "";
  private remote?: OpenRouterChat;
  get modelLabel() {
    try { const config = modelConfig(); return config.provider === "local" ? `Local ${config.model}` : `OpenRouter ${config.model}`; }
    catch { return "Model configuration incomplete; check LLM_PROVIDER / OPENROUTER_MODEL"; }
  }
  private starting?: Promise<void>;
  private pending = new Map<string, { resolve: (reply: AudioReply) => void; reject: (error: Error) => void }>();
  constructor(private readonly update: (message: string) => void = () => {}) {}
  private environment(extra: Record<string, string> = {}) {
    return { ...childEnvironment(process.env), PYTHONUNBUFFERED: "1", HF_HUB_DISABLE_TELEMETRY: "1", HOMEBREW_NO_AUTO_UPDATE: "1", ...extra };
  }
  private launch(argv: string[], env: Record<string, string> = {}) {
    this.stopSignal.signal.throwIfAborted();
    const child = Bun.spawn(argv, { cwd: root, env: this.environment(env), detached: true, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.children.add(child);
    void child.exited.then(() => this.children.delete(child));
    return child;
  }
  private async command(argv: string[]) {
    let tail = "";
    const child = this.launch(argv);
    child.stdin.end();
    const consume = (line: string) => { tail = (tail + "\n" + line).slice(-3000); this.update(line.slice(0, 180)); };
    const [exit] = await Promise.all([child.exited, streamLines(child.stdout, consume), streamLines(child.stderr, consume)]);
    this.stopSignal.signal.throwIfAborted();
    if (exit) throw new Error(`${argv[0]} failed (${exit}). ${tail}`);
  }
  private async download(asset: Asset) {
    const path = join(voiceDir, asset.path);
    const file = Bun.file(path);
    if (await file.exists() && file.size > 0 && (!asset.size || file.size === asset.size)) return;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    this.update(`Downloading ${asset.path}…`);
    const response = await fetch(asset.url, { signal: AbortSignal.any([this.stopSignal.signal, AbortSignal.timeout(30 * 60000)]) });
    if (!response.ok || !response.body) throw new Error(`Download ${asset.path}: HTTP ${response.status}`);
    const part = path + ".part";
    const writer = Bun.file(part).writer();
    const hash = new Bun.CryptoHasher("sha256");
    let bytes = 0, lastUpdate = 0;
    try {
      for await (const chunk of response.body) {
        writer.write(chunk); hash.update(chunk); bytes += chunk.byteLength;
        if (Date.now() - lastUpdate > 1000) { this.update(`${asset.path}: ${Math.round(bytes / 1048576)} MB${asset.size ? ` / ${Math.round(asset.size / 1048576)} MB` : ""}`); lastUpdate = Date.now(); }
      }
      await writer.end();
      if ((asset.size && bytes !== asset.size) || (asset.sha256 && hash.digest("hex") !== asset.sha256)) throw new Error(`Incomplete or corrupt download: ${asset.path}`);
      await chmod(part, 0o600); await rename(part, path);
    } catch (error) { await Promise.resolve(writer.end()).catch(() => {}); await rm(part, { force: true }); throw error; }
  }
  async start(): Promise<void> {
    if (this.state === "ready") return;
    if (this.starting) return this.starting;
    if (this.state === "stopped") throw new Error("Runtime has been stopped; start a new workbench session.");
    if (this.state === "error") this.stopProcesses();
    this.starting = this.prepare().catch(error => {
      this.stopProcesses(); this.state = "error";
      this.error = error instanceof Error ? error.message : String(error); this.update(this.error); throw error;
    }).finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private async prepare() {
    if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Local voice requires Apple Silicon macOS. Use bun start --offline on other systems.");
    this.state = "installing"; this.error = "";
    const config = modelConfig();
    this.remote = config.provider === "openrouter" ? new OpenRouterChat(config, await openRouterKey()) : undefined;
    this.update(`Model: ${this.modelLabel}`);
    await mkdir(join(voiceDir, "audio"), { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700); await chmod(voiceDir, 0o700);
    const brew = Bun.which("brew") ?? (await Bun.file("/opt/homebrew/bin/brew").exists() ? "/opt/homebrew/bin/brew" : null);
    let uv = Bun.which("uv"), ollama = Bun.which("ollama");
    const missing = runtimeExecutables(config).filter(name => name === "uv" ? !uv : !ollama);
    if (missing.length) {
      if (!brew) throw new Error("Install Homebrew first (brew.sh), then rerun bun start. No sudo installer is run by the workbench.");
      this.update(`Installing ${missing.join(", ")} through Homebrew…`);
      await this.command([brew, "install", ...missing]);
      uv = Bun.which("uv") ?? "/opt/homebrew/bin/uv";
      ollama = Bun.which("ollama") ?? "/opt/homebrew/bin/ollama";
    }
    const python = join(voiceDir, "venv/bin/python");
    const requirements = await readFile(join(root, "local-voice/requirements.txt"), "utf8");
    const fingerprint = new Bun.CryptoHasher("sha256").update(requirements).digest("hex");
    let installed = "";
    try { installed = await readFile(join(voiceDir, "dependencies.sha256"), "utf8"); } catch { /* first launch */ }
    if (installed !== fingerprint || !await Bun.file(python).exists()) {
      this.update("Preparing isolated Python 3.12 audio environment…");
      for (const command of installationCommands(uv!, python, voiceDir)) await this.command(command);
      await writeFile(join(voiceDir, "dependencies.sha256"), fingerprint, { mode: 0o600 });
    }
    for (const asset of assets) await this.download(asset);
    if (config.provider === "local") await this.startOllama(ollama!);
    this.worker = this.launch([python, join(root, "local-voice/worker.py"), voiceDir]);
    const worker = this.worker;
    let workerTail = "";
    void streamLines(this.worker.stderr, line => { workerTail = (workerTail + "\n" + line).slice(-2000); }).catch(() => {});
    void streamLines(this.worker.stdout, line => {
      try {
        const reply = JSON.parse(line);
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        this.pending.delete(reply.id);
        if (reply.error) pending.reject(new Error(String(reply.error)));
        else pending.resolve({ ...reply.result, elapsed_ms: reply.elapsed_ms });
      } catch { /* Native libraries occasionally write diagnostic lines to stdout. */ }
    }).catch(() => { if (this.worker === worker) for (const pending of [...this.pending.values()]) pending.reject(new Error("Audio worker protocol failed; retry setup.")); });
    void worker.exited.then(() => {
      if (this.worker !== worker) return;
      for (const pending of [...this.pending.values()]) pending.reject(new Error(`Audio worker exited. ${workerTail}`));
      this.pending.clear();
      if (this.worker === worker && this.state === "ready") { this.state = "error"; this.error = "Audio worker exited; retry setup."; this.update(this.error); }
    });
    this.update("Warming Whisper, English/Spanish/Catalan voices and the language model…");
    await this.audio("warmup", {}, this.stopSignal.signal);
    await this.chat([{ role: "user", content: "Reply with the word ready." }], [], this.stopSignal.signal);
    if (worker.exitCode !== null || (this.llm && this.llm.exitCode !== null)) throw new Error("Local process exited during warmup; retry setup.");
    this.state = "ready"; this.update(`Voice ready: ${this.modelLabel} + local Whisper small (MLX) + Piper.`);
  }
  private async startOllama(ollama: string) {
    const port = await freePort();
    this.origin = `http://127.0.0.1:${port}`;
    this.update("Starting private Ollama process…");
    const llm = this.launch([ollama, "serve"], { OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_MODELS: join(voiceDir, "ollama"), OLLAMA_NUM_PARALLEL: "1", OLLAMA_CONTEXT_LENGTH: "8192", OLLAMA_NO_CLOUD: "1" });
    this.llm = llm;
    void llm.exited.then(() => {
      if (this.llm === llm && this.state === "ready") {
        this.state = "error"; this.error = "Local language model exited; retry setup."; this.update(this.error);
      }
    });
    let serverTail = "";
    const retain = (line: string) => { serverTail = (serverTail + "\n" + line).slice(-2000); };
    void streamLines(llm.stderr, retain).catch(() => {}); void streamLines(llm.stdout, retain).catch(() => {});
    let available = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      this.stopSignal.signal.throwIfAborted();
      if (llm.exitCode !== null) throw new Error(`Ollama exited: ${serverTail}`);
      try { available = (await fetch(`${this.origin}/api/version`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* booting */ }
      if (available) break;
      await Bun.sleep(250);
    }
    if (!available) throw new Error(`Ollama startup timed out. ${serverTail}`);
    const listed = await fetch(`${this.origin}/api/tags`, { signal: this.stopSignal.signal });
    if (!listed.ok) throw new Error(`Cannot inspect cached models: HTTP ${listed.status}`);
    const cache = await listed.json();
    if (!Array.isArray(cache.models) || !cache.models.some((model: { name?: string }) => model.name === MODEL)) {
      this.update(`Downloading ${MODEL} (first launch ~3.4 GB)…`);
      const pull = await fetch(`${this.origin}/api/pull`, { method: "POST", body: JSON.stringify({ model: MODEL, stream: true }), signal: this.stopSignal.signal });
      if (!pull.ok || !pull.body) throw new Error(`Ollama model download failed: HTTP ${pull.status}`);
      let pullError = "", complete = false;
      await streamLines(pull.body, line => {
        const item = JSON.parse(line);
        if (item.error) pullError = String(item.error);
        if (item.status === "success") complete = true;
        this.update(`${MODEL}: ${item.status ?? "downloading"}${item.total ? ` ${Math.round(item.completed / item.total * 100)}%` : ""}`);
      });
      if (pullError || !complete) throw new Error(pullError || "Incomplete model pull; rerun setup to resume.");
    } else this.update(`Using cached ${MODEL}.`);
  }
  async chat(messages: Message[], tools: unknown[], signal: AbortSignal, format?: unknown): Promise<ChatReply> {
    const lifetime = AbortSignal.any([signal, this.stopSignal.signal]);
    lifetime.throwIfAborted();
    if (this.remote) return this.remote.chat(messages, tools, lifetime, format);
    if (!this.origin) throw new Error("Start the voice runtime first");
    const started = performance.now();
    const response = await fetch(`${this.origin}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, tools: tools.length ? tools : undefined, format, stream: false, think: false,
        keep_alive: "30m", options: { temperature: 0.1, num_ctx: 16384, num_predict: 1024 } }),
      signal: AbortSignal.any([signal, this.stopSignal.signal, AbortSignal.timeout(120000)]) });
    if (!response.ok) throw new Error(`Local model: HTTP ${response.status}`);
    const data = await response.json();
    if (data.error || !isObject(data.message) || typeof data.message.content !== "string") throw new Error(String(data.error ?? "Malformed local model response"));
    return { message: data.message as unknown as Message, elapsed_ms: Math.round(performance.now() - started) };
  }
  async audio(operation: string, fields: ObjectValue, signal: AbortSignal): Promise<AudioReply> {
    signal.throwIfAborted();
    if (!this.worker || this.worker.exitCode !== null) throw new Error("Audio worker is not running; retry local setup.");
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); this.pending.delete(id); };
      const abort = () => { finish(); this.stopProcesses(); this.state = "error"; reject(new Error("Voice operation cancelled; retry setup to restart local processes.")); };
      const timer = setTimeout(() => { finish(); this.stopProcesses(); this.state = "error"; reject(new Error("Audio operation timed out; retry setup.")); }, 120000);
      this.pending.set(id, { resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); } });
      signal.addEventListener("abort", abort, { once: true });
      this.worker!.stdin.write(JSON.stringify({ ...fields, operation, id }) + "\n");
      this.worker!.stdin.flush();
    });
  }
  async removeAudio(file: string) { if (/^[\w-]+\.wav$/.test(file)) await rm(join(voiceDir, "audio", file), { force: true }); }
  private stopProcesses() {
    for (const child of this.children) {
      killOwned(child.pid);
      // Escalate only while this exact child remains alive; never kill an unrelated daemon.
      const timer = setTimeout(() => { if (child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } }, 1500);
      timer.unref();
    }
    this.children.clear(); this.worker = undefined; this.llm = undefined; this.remote = undefined; this.origin = "";
    for (const pending of [...this.pending.values()]) pending.reject(new Error("Local runtime stopped"));
    this.pending.clear();
  }
  stop() { this.stopSignal.abort(); this.stopProcesses(); this.state = "stopped"; }
}
