import { isObject } from "../validation";
import { MODEL } from "./assets";
import { chatMessages, parseChatReply } from "./chat-protocol";
import { WorkQueue } from "./queue";
import { type ChatReply, type Message } from "./runtime";
import { type LocalSettings } from "./settings";

export function llamaArguments(modelPath: string, port: number, settings: LocalSettings): string[] {
  return ["--model", modelPath, "--alias", MODEL, "--host", "127.0.0.1", "--port", String(port),
    "--parallel", String(settings.parallel), "--ctx-size", String(settings.context * settings.parallel),
    "--gpu-layers", "999", "--jinja", "--cont-batching", "--no-context-shift",
    "--reasoning", "off", "--cors-origins", "localhost"];
}

/** Verify server capacity, rather than treating client concurrency as active model slots. */
export function llamaCapacity(props: unknown, settings: LocalSettings) {
  if (!isObject(props) || props.total_slots !== settings.parallel || !isObject(props.default_generation_settings)
    || typeof props.default_generation_settings.n_ctx !== "number" || props.default_generation_settings.n_ctx < settings.context)
    throw new Error("llama-server did not expose the requested slots/context; update llama.cpp and retry");
  return { backend: "llama" as const, slots: props.total_slots, context_per_slot: props.default_generation_settings.n_ctx,
    ...(typeof props.build_info === "string" ? { build: props.build_info } : {}) };
}

export class LlamaChat {
  private queue: WorkQueue;
  constructor(private origin: string, private settings: LocalSettings,
    private request: (url: string, init: RequestInit) => Promise<Response> = fetch) {
    this.queue = new WorkQueue(settings.parallel);
  }
  chat(messages: Message[], tools: unknown[], signal: AbortSignal, format?: unknown): Promise<ChatReply> {
    const started = performance.now();
    return this.queue.run(async queue_ms => {
      signal.throwIfAborted();
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
      const response = await this.request(`${this.origin}/v1/chat/completions`, {
        method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, signal: requestSignal,
        body: JSON.stringify({ model: MODEL, messages: chatMessages(messages, "Local model"),
          stream: false, temperature: 0.1, max_tokens: this.settings.maxTokens,
          ...(tools.length ? { tools, tool_choice: "auto", parallel_tool_calls: false } : {}),
          ...(format ? { response_format: { type: "json_schema", json_schema: { name: "voice_response", strict: true, schema: format } } } : {}),
        }),
      });
      if (!response.ok) throw new Error(`Local model: HTTP ${response.status}`);
      const data: unknown = await response.json();
      requestSignal.throwIfAborted();
      const message = parseChatReply(data, "Local model");
      const metrics: Record<string, number | string> = { provider: "local", backend: "llama", model: MODEL, queue_ms };
      if (isObject(data)) {
        for (const [source, fields] of [
          [data.timings, { prompt_ms: "prefill_ms", predicted_ms: "decode_ms", cache_n: "cached_tokens" }],
          [data.usage, { prompt_tokens: "prompt_tokens", completion_tokens: "completion_tokens", total_tokens: "total_tokens" }],
        ] as const) {
          if (isObject(source)) for (const [key, target] of Object.entries(fields)) {
            const value = source[key];
            if (typeof value === "number" && Number.isFinite(value) && value >= 0) metrics[target] = value;
          }
        }
      }
      return { message, elapsed_ms: Math.round(performance.now() - started), metrics };
    }, signal);
  }
}
