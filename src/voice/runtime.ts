import { mkdir, chmod, rename, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import { root, type ObjectValue } from "../data";
import { stateDir } from "../storage";
import { speechAssets, vadAsset, qwenAsset, MODEL, type Asset } from "./assets";
import { childEnvironment, modelConfig, openRouterKey, runtimeExecutables } from "./model";
import { OpenRouterChat } from "./openrouter";
import { OllamaChat } from "./ollama";
import { LlamaChat, llamaArguments, llamaCapacity } from "./llama";
import { localSettings, type LocalSettings } from "./settings";
import { isTranscription, OpenRouterTranscription, transcriptionConfig, type TranscriptionConfig } from "./transcription";

type Worker = { process: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>; role: "asr" | "tts" | "capture"; pending: number };

export interface Message { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: ToolCall[]; tool_name?: string; tool_call_id?: string; reasoning_details?: unknown[] }
export interface ToolCall { id?: string; arguments_text?: string; function: { name: string; arguments: ObjectValue } }
export interface ChatReply { message: Message; elapsed_ms: number; metrics?: Record<string, number | string> }
export interface AudioReply { text?: string; payload?: string; file?: string; language?: string; decoder?: string; skip_reason?: string; input_rms?: number; duration_ms?: number; elapsed_ms: number; queue_ms?: number; total_ms?: number; cache_hit?: boolean; metrics?: Record<string, string | number> }
export interface Inference {
  readonly recognitionConcurrency?: number;
  readonly cancellableRecognition?: boolean;
  chat(messages: Message[], tools: unknown[], signal: AbortSignal, format?: unknown): Promise<ChatReply>;
  audio(operation: string, fields: ObjectValue, signal: AbortSignal): Promise<AudioReply>;
  removeAudio(file: string): Promise<void>;
}
export const voiceDir = join(stateDir, "voice");

export function audioRuntimePlan(settings: LocalSettings, transcription: TranscriptionConfig, recognitionOnly = false) {
  const remote = transcription.provider === "openrouter";
  const selected = speechAssets(settings.asrModel);
  const assets = recognitionOnly ? (remote ? [] : selected.filter(asset => asset.path.startsWith("whisper")))
    : [...selected.filter(asset => !remote || !asset.path.startsWith("whisper")), vadAsset];
  const roles: Worker["role"][] = recognitionOnly ? (remote ? [] : ["asr"])
    : [remote ? "capture" : "asr", ...Array<"tts">(settings.ttsWorkers).fill("tts")];
  return { assets, roles };
}

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
  private workers: Worker[] = [];
  readonly settings: LocalSettings;
  readonly transcription: TranscriptionConfig;
  get recognitionConcurrency() { return this.transcription.concurrency; }
  get cancellableRecognition() { return this.transcription.provider === "openrouter"; }
  get recognitionLabel() { return this.transcription.provider === "openrouter"
    ? `OpenRouter ${this.transcription.model} (managed routing, ${this.transcription.concurrency} requests)`
    : `Whisper ${this.settings.asrModel}/${this.settings.asrDecoder}`; }
  private remoteRecognition?: OpenRouterTranscription;
  private local?: OllamaChat | LlamaChat;
  modelRuntime?: { backend: string; slots: number; context_per_slot: number; build?: string; model_asset?: string; model_sha256?: string };
  private llm?: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  private origin = "";
  private remote?: OpenRouterChat;
  get modelLabel() {
    if (this.options.recognitionOnly) return `${this.recognitionLabel} (recognition only)`;
    try { const config = modelConfig(); return config.provider === "local" ? `Local ${config.model} (${this.settings.backend})` : `OpenRouter ${config.model}`; }
    catch { return "Model configuration incomplete; check LLM_PROVIDER / OPENROUTER_MODEL"; }
  }
  private starting?: Promise<void>;
  private pending = new Map<string, { resolve: (reply: AudioReply) => void; reject: (error: Error) => void }>();
  constructor(private readonly update: (message: string) => void = () => {},
    private readonly options: { recognitionOnly?: boolean; settings?: LocalSettings; transcription?: TranscriptionConfig } = {}) {
    this.settings = options.settings ?? localSettings();
    this.transcription = options.transcription ?? transcriptionConfig();
  }
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
    const config = this.options.recognitionOnly ? { provider: "local" as const, model: MODEL } : modelConfig();
    const key = config.provider === "openrouter" || this.transcription.provider === "openrouter" ? await openRouterKey() : undefined;
    this.remote = config.provider === "openrouter" ? new OpenRouterChat(config, key!) : undefined;
    this.remoteRecognition = this.transcription.provider === "openrouter"
      ? new OpenRouterTranscription(this.transcription, key!, join(voiceDir, "audio")) : undefined;
    this.update(`Model: ${this.modelLabel}`);
    await mkdir(join(voiceDir, "audio"), { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700); await chmod(voiceDir, 0o700);
    this.update(`Recognition: ${this.recognitionLabel}`);
    if (this.options.recognitionOnly && this.remoteRecognition) {
      this.state = "ready"; this.update("Remote recognition configured; no billable warmup request sent."); return;
    }
    const brew = Bun.which("brew") ?? (await Bun.file("/opt/homebrew/bin/brew").exists() ? "/opt/homebrew/bin/brew" : null);
    const executables = runtimeExecutables(config, this.settings.backend, this.options.recognitionOnly);
    const missing = executables.filter(name => !Bun.which(name));
    if (missing.length) {
      if (!brew) throw new Error("Install Homebrew first (brew.sh), then rerun bun start. No sudo installer is run by the workbench.");
      this.update(`Installing ${missing.join(", ")} through Homebrew…`);
      await this.command([brew, "install", ...missing.map(name => name === "llama-server" ? "llama.cpp" : name)]);
    }
    const executable = (name: string) => Bun.which(name) ?? `/opt/homebrew/bin/${name}`;
    const python = join(voiceDir, "venv/bin/python");
    const requirements = await readFile(join(root, "local-voice/requirements.txt"), "utf8");
    const fingerprint = new Bun.CryptoHasher("sha256").update(requirements).digest("hex");
    let installed = "";
    try { installed = await readFile(join(voiceDir, "dependencies.sha256"), "utf8"); } catch { /* first launch */ }
    if (installed !== fingerprint || !await Bun.file(python).exists()) {
      this.update("Preparing isolated Python 3.12 audio environment…");
      for (const command of installationCommands(executable("uv"), python, voiceDir)) await this.command(command);
      await writeFile(join(voiceDir, "dependencies.sha256"), fingerprint, { mode: 0o600 });
    }
    const plan = audioRuntimePlan(this.settings, this.transcription, this.options.recognitionOnly);
    for (const asset of plan.assets) await this.download(asset);
    if (config.provider === "local" && !this.options.recognitionOnly) {
      if (this.settings.backend === "llama") await this.startLlama(executable("llama-server"));
      else await this.startOllama(executable("ollama"));
    }
    for (const role of plan.roles) this.startWorker(python, role);
    this.update(this.options.recognitionOnly ? "Warming recognition…" : "Warming recognition, speech workers and the language model…");
    // Warm every worker explicitly; a pool request could otherwise reuse the first worker.
    for (const worker of this.workers) await this.workerRequest(worker, "warmup", {}, this.stopSignal.signal);
    if (!this.options.recognitionOnly) await this.chat([{ role: "user", content: "Reply with the word ready." }], [], this.stopSignal.signal);
    if (this.workers.some(worker => worker.process.exitCode !== null) || (this.llm && this.llm.exitCode !== null)) throw new Error("Local process exited during warmup; retry setup.");
    this.state = "ready";
    this.update(this.options.recognitionOnly ? `${this.modelLabel} ready.` : `Voice ready: ${this.modelLabel}${this.modelRuntime ? ` (${this.modelRuntime.slots} local slots)` : ""} + ${this.recognitionLabel} + ${this.settings.ttsWorkers} Piper workers.`);
  }
  private async startLlama(executable: string) {
    const modelPath = join(voiceDir, qwenAsset.path);
    await this.download(qwenAsset);
    const port = await freePort();
    this.origin = `http://127.0.0.1:${port}`;
    this.update("Starting private llama-server with continuous batching…");
    const llm = this.launch([executable, ...llamaArguments(modelPath, port, this.settings)]);
    this.llm = llm;
    llm.stdin.end();
    let tail = "";
    const retain = (line: string) => { tail = (tail + "\n" + line).slice(-3000); };
    void streamLines(llm.stderr, retain).catch(() => {}); void streamLines(llm.stdout, retain).catch(() => {});
    void llm.exited.then(() => {
      if (this.llm === llm && this.state === "ready") {
        this.state = "error"; this.error = "Local language model exited; retry setup."; this.update(this.error);
      }
    });
    let available = false;
    for (let attempt = 0; attempt < 480; attempt++) {
      this.stopSignal.signal.throwIfAborted();
      if (llm.exitCode !== null) throw new Error(`llama-server exited while loading ${qwenAsset.path}. ${tail}`);
      try { available = (await fetch(`${this.origin}/health`, { signal: AbortSignal.any([this.stopSignal.signal, AbortSignal.timeout(500)]) })).ok; } catch { /* loading */ }
      if (available) break;
      await Bun.sleep(250);
    }
    if (!available) throw new Error(`llama-server startup timed out. ${tail}`);
    const props = await fetch(`${this.origin}/props`, { signal: AbortSignal.any([this.stopSignal.signal, AbortSignal.timeout(5000)]) });
    if (!props.ok) throw new Error(`Cannot verify llama-server capacity: HTTP ${props.status}`);
    this.modelRuntime = { ...llamaCapacity(await props.json(), this.settings), model_asset: qwenAsset.path, model_sha256: qwenAsset.sha256 };
    this.local = new LlamaChat(this.origin, this.settings);
    this.update(`llama-server reports ${this.modelRuntime.slots} slots, ${this.modelRuntime.context_per_slot} context tokens per slot.`);
  }
  private startWorker(python: string, role: Worker["role"]) {
    const child = this.launch([python, join(root, "local-voice/worker.py"), voiceDir, role], {
      LOCAL_ASR_MODEL: this.settings.asrModel, LOCAL_ASR_DECODER: this.settings.asrDecoder, LOCAL_TTS_THREADS: String(this.settings.ttsThreads),
      OMP_NUM_THREADS: String(this.settings.ttsThreads), OPENBLAS_NUM_THREADS: "1", HF_HUB_OFFLINE: "1",
    });
    const worker: Worker = { process: child, role, pending: 0 };
    this.workers.push(worker);
    let tail = "";
    const fail = (message: string) => {
      if (!this.workers.includes(worker)) return;
      this.stopProcesses(); this.state = "error"; this.error = message; this.update(message);
    };
    void streamLines(child.stderr, line => { tail = (tail + "\n" + line).slice(-2000); }).catch(() => {});
    void streamLines(child.stdout, line => {
      try {
        const reply = JSON.parse(line), pending = this.pending.get(reply.id);
        if (!pending) return;
        if (reply.error) pending.reject(new Error(String(reply.error)));
        else pending.resolve({ ...reply.result, elapsed_ms: reply.elapsed_ms });
      } catch { /* Ignore native diagnostic lines. */ }
    }).catch(() => fail(`${role} worker protocol failed; retry setup.`));
    void child.exited.then(() => fail(`${role} worker exited. ${tail}`));
  }
  private async startOllama(ollama: string) {
    const port = await freePort();
    this.origin = `http://127.0.0.1:${port}`;
    this.update("Starting private Ollama baseline (one slot: Qwen3.5 parallelism is disabled by Ollama 0.34.1)…");
    const llm = this.launch([ollama, "serve"], { OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_MODELS: join(voiceDir, "ollama"), OLLAMA_NUM_PARALLEL: "1", OLLAMA_CONTEXT_LENGTH: String(this.settings.context), OLLAMA_MAX_LOADED_MODELS: "1", OLLAMA_MAX_QUEUE: "64", OLLAMA_NO_CLOUD: "1" });
    this.llm = llm;
    this.local = new OllamaChat(this.origin, { ...this.settings, parallel: 1 });
    this.modelRuntime = { backend: "ollama", slots: 1, context_per_slot: this.settings.context };
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
    if (!this.local) throw new Error("Start the voice runtime first");
    return this.local.chat(messages, tools, lifetime, format);
  }
  async audio(operation: string, fields: ObjectValue, signal: AbortSignal): Promise<AudioReply> {
    signal.throwIfAborted();
    if (this.remoteRecognition && isTranscription(operation))
      return this.remoteRecognition.audio(operation, fields, AbortSignal.any([signal, this.stopSignal.signal]));
    const role = operation === "speak" ? "tts" : this.transcription.provider === "openrouter" ? "capture" : "asr";
    const worker = this.workers.filter(worker => worker.role === role && worker.process.exitCode === null)
      .sort((a, b) => a.pending - b.pending)[0];
    if (!worker) throw new Error("Audio worker is not running; retry local setup.");
    if (worker.pending >= 60) throw new Error("Native audio queue is full");
    return this.workerRequest(worker, operation, fields, signal);
  }
  private workerRequest(worker: Worker, operation: string, fields: ObjectValue, signal: AbortSignal): Promise<AudioReply> {
    signal.throwIfAborted();
    const id = crypto.randomUUID(); worker.pending++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
        this.pending.delete(id); worker.pending--; return true;
      };
      // Platform callers pass only the shared lifetime here; SharedAudio handles per-call cancellation.
      // Direct TUI cancellation must also stop device playback / a pending microphone open.
      const abort = () => {
        if (!finish()) return;
        reject(new Error("Voice operation cancelled; retry setup to restart local processes."));
        this.stopProcesses(); this.state = "error";
      };
      const timer = setTimeout(() => {
        if (!finish()) return;
        reject(new Error("Audio operation timed out; retry setup."));
        this.stopProcesses(); this.state = "error";
      }, 120000);
      this.pending.set(id, {
        resolve: value => { if (finish()) resolve(value); },
        reject: error => { if (finish()) reject(error); },
      });
      signal.addEventListener("abort", abort, { once: true });
      try {
        worker.process.stdin.write(JSON.stringify({ ...fields, operation, id }) + "\n");
        worker.process.stdin.flush();
      } catch (error) { this.pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error))); }
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
    this.children.clear(); this.workers = []; this.modelRuntime = undefined; this.local = undefined; this.llm = undefined; this.remote = undefined; this.remoteRecognition = undefined; this.origin = "";
    for (const pending of [...this.pending.values()]) pending.reject(new Error("Local runtime stopped"));
    this.pending.clear();
  }
  stop() { this.stopSignal.abort(); this.stopProcesses(); this.state = "stopped"; }
}
