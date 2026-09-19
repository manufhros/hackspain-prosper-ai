import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { MetricsStore } from "./metrics.ts";

export type CallStatus =
  | "active"
  | "completed"
  | "missed"
  | "failed"
  | "interrupted";
export type Transcript = {
  id: string;
  role: "agent" | "user";
  text: string;
  at: string;
  corrected?: boolean;
};
export type ToolRun = {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
};
export type Call = {
  id: string;
  name: string;
  phone: string;
  startedAt: string;
  endedAt?: string;
  status: CallStatus;
  connected: boolean;
  error?: string;
  transcript: Transcript[];
  tools: ToolRun[];
  revision: number;
};
export type CallSummary = Omit<Call, "transcript" | "tools"> & {
  messages: number;
  toolCount: number;
};

const MAX_CALLS = 200;
const MAX_ITEMS = 400;
const MAX_TEXT = 12_000;

// Tool payloads may contain credentials. Never persist those named fields.
export function safePayload(value: unknown): unknown {
  const serialized =
    JSON.stringify(value, (key, item: unknown) =>
      /api.?key|authorization|token|password|secret/i.test(key)
        ? "[oculto]"
        : item,
    ) ?? "null";
  if (serialized.length > MAX_TEXT)
    return `${serialized.slice(0, MAX_TEXT)}… [contenido limitado]`;
  return JSON.parse(serialized) as unknown;
}

export function summarize(call: Call): CallSummary {
  const { transcript, tools, ...summary } = call;
  return { ...summary, messages: transcript.length, toolCount: tools.length };
}

export class CallStore extends EventEmitter {
  private calls = new Map<string, Call>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing = Promise.resolve();
  private historyStorageError = false;
  get storageError(): boolean {
    return this.historyStorageError || this.metrics.storageError;
  }

  constructor(
    private file: string | undefined = undefined,
    readonly metrics = new MetricsStore(),
  ) {
    super();
    this.setMaxListeners(12);
  }

  async load(): Promise<void> {
    if (!this.file) return;
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8")) as Call[];
      if (!Array.isArray(saved)) throw new Error("Invalid call history");
      for (const call of saved.slice(0, MAX_CALLS)) {
        if (
          !call.id ||
          !Array.isArray(call.transcript) ||
          !Array.isArray(call.tools)
        )
          continue;
        if (call.status === "active") {
          call.status = "interrupted";
          call.endedAt =
            call.tools.at(-1)?.endedAt ??
            call.transcript.at(-1)?.at ??
            call.startedAt;
        }
        for (const tool of call.tools) {
          if (tool.status === "running") tool.status = "interrupted";
        }
        this.calls.set(call.id, call);
        this.metrics.recordCall(call);
        for (const tool of call.tools) this.metrics.recordTool(call.id, tool);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.historyStorageError = true;
        // Do not overwrite an unreadable history file.
        this.file = undefined;
      }
    }
  }

  list(): CallSummary[] {
    return [...this.calls.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(summarize);
  }

  get(id: string): Call | undefined {
    return this.calls.get(id);
  }

  start(id: string, phone = ""): void {
    if (this.calls.has(id)) return;
    this.calls.set(id, {
      id,
      phone,
      name: phone || "Número oculto",
      startedAt: new Date().toISOString(),
      status: "active",
      connected: false,
      transcript: [],
      tools: [],
      revision: 0,
    });
    this.changed(id);
  }

  connected(id: string): void {
    const call = this.get(id);
    if (!call) return;
    call.connected = true;
    this.changed(id);
  }

  message(id: string, role: Transcript["role"], text: string): void {
    const call = this.get(id);
    if (!call || !text.trim()) return;
    call.transcript.push({
      id: randomUUID(),
      role,
      text: text.slice(0, MAX_TEXT),
      at: new Date().toISOString(),
    });
    call.transcript = call.transcript.slice(-MAX_ITEMS);
    this.changed(id);
  }

  correct(id: string, original: string, text: string): void {
    const call = this.get(id);
    const message = call?.transcript
      .slice()
      .reverse()
      .find((item) => item.role === "agent" && item.text === original);
    if (!message) return;
    message.text = text.slice(0, MAX_TEXT);
    message.corrected = true;
    this.changed(id);
  }

  toolStart(id: string, toolId: string, name: string, input: unknown): void {
    const call = this.get(id);
    if (!call || call.tools.some((tool) => tool.id === toolId)) return;
    const tool: ToolRun = {
      id: toolId,
      name,
      input: safePayload(input),
      status: "running",
      startedAt: new Date().toISOString(),
    };
    call.tools.push(tool);
    call.tools = call.tools.slice(-MAX_ITEMS);
    this.changed(id, tool);
  }

  toolEnd(id: string, toolId: string, result: string, failed = false): void {
    const call = this.get(id);
    const tool = call?.tools.find((item) => item.id === toolId);
    if (!call || !tool) return;
    let output: unknown = result;
    try {
      output = JSON.parse(result);
    } catch {
      /* Plain text tool response. */
    }
    const object =
      typeof output === "object" && output !== null
        ? (output as Record<string, unknown>)
        : {};
    tool.status = failed || Boolean(object.error) ? "failed" : "completed";
    tool.output = safePayload(output);
    tool.endedAt = new Date().toISOString();
    tool.durationMs = Date.parse(tool.endedAt) - Date.parse(tool.startedAt);
    if (
      tool.name === "search_directory" &&
      Array.isArray(object.matches) &&
      object.matches.length === 1
    ) {
      const match = object.matches[0] as Record<string, unknown>;
      const name = [match.given_name, match.first_surname, match.second_surname]
        .filter((part) => typeof part === "string")
        .join(" ");
      if (name) call.name = name;
    }
    this.changed(id, tool, output);
  }

  fail(id: string, message: string): void {
    const call = this.get(id);
    if (!call || call.status !== "active") return;
    call.error = message;
    this.finish(id, "failed");
  }

  finish(id: string, status?: CallStatus): void {
    const call = this.get(id);
    if (!call || call.status !== "active") return;
    call.status = status ?? (call.connected ? "completed" : "missed");
    call.endedAt = new Date().toISOString();
    this.changed(id);
  }

  settleTools(id: string): void {
    const call = this.get(id);
    if (!call) return;
    for (const tool of call.tools)
      if (tool.status === "running") {
        tool.status = "interrupted";
        this.metrics.recordTool(id, tool);
      }
    this.changed(id);
  }

  private changed(id: string, tool?: ToolRun, output?: unknown): void {
    const call = this.get(id);
    if (!call) return;
    call.revision += 1;
    this.metrics.recordCall(call);
    if (tool) this.metrics.recordTool(id, tool, output);
    const ended = this.list()
      .filter((item) => item.status !== "active")
      .reverse();
    while (this.calls.size > MAX_CALLS && ended.length)
      this.calls.delete(ended.shift()!.id);
    this.emit("change", summarize(call));
    if (!this.timer && this.file)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 250);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const file = this.file;
    if (!file) return;
    const payload = JSON.stringify(
      this.list().map((item) => this.get(item.id)),
    );
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, payload, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        this.historyStorageError = false;
      } catch {
        this.historyStorageError = true;
      }
    });
    await this.writing;
  }
}
