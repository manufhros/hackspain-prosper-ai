import { isObject } from "../validation";
import { MODEL } from "./assets";
import { type ChatReply, type Message } from "./runtime";
import { type LocalSettings } from "./settings";
import { WorkQueue } from "./queue";

export class OllamaChat {
  private queue: WorkQueue;
  constructor(private origin: string, private settings: LocalSettings,
    private request: (url: string, init: RequestInit) => Promise<Response> = fetch) {
    this.queue = new WorkQueue(settings.parallel);
  }
  chat(messages: Message[], tools: unknown[], signal: AbortSignal, format?: unknown): Promise<ChatReply> {
    const started = performance.now();
    return this.queue.run(async queue_ms => {
      signal.throwIfAborted();
      const response = await this.request(`${this.origin}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages, tools: tools.length ? tools : undefined, format,
          stream: false, think: false, keep_alive: "30m",
          options: { temperature: 0.1, num_ctx: this.settings.context, num_predict: this.settings.maxTokens } }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
      });
      if (!response.ok) throw new Error(`Local model: HTTP ${response.status}`);
      const data = await response.json();
      signal.throwIfAborted();
      if (data.error || !isObject(data.message) || typeof data.message.content !== "string") throw new Error(String(data.error ?? "Malformed local model response"));
      if (data.done_reason === "length") throw new Error("Local model output truncated; increase LOCAL_LLM_MAX_TOKENS");
      const metrics: Record<string, number | string> = { provider: "local", model: MODEL, queue_ms };
      for (const [field, label] of Object.entries({ total_duration: "inference_ms", load_duration: "load_ms", prompt_eval_duration: "prefill_ms", eval_duration: "decode_ms" })) {
        if (typeof data[field] === "number") metrics[label] = Math.round(data[field] / 1e6);
      }
      if (typeof data.prompt_eval_count === "number") metrics.prompt_tokens = data.prompt_eval_count;
      if (typeof data.eval_count === "number") metrics.completion_tokens = data.eval_count;
      return { message: data.message as unknown as Message, elapsed_ms: Math.round(performance.now() - started), metrics };
    }, signal);
  }
}
