import { isObject } from "../validation";
import { type ChatReply, type Message } from "./runtime";
import { chatMessages, parseChatReply } from "./chat-protocol";
import { type ModelConfig } from "./model";

type FetchChat = (url: string, init: RequestInit) => Promise<Response>;
const endpoint = "https://openrouter.ai/api/v1/chat/completions";

export const openRouterMessages = (messages: Message[]) => chatMessages(messages, "OpenRouter");

export class OpenRouterChat {
  constructor(private config: Extract<ModelConfig, { provider: "openrouter" }>, private key: string,
    private fetchChat: FetchChat = (url, init) => fetch(url, init)) {}

  async chat(messages: Message[], tools: unknown[], signal: AbortSignal, format?: unknown): Promise<ChatReply> {
    signal.throwIfAborted();
    const started = performance.now();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs ?? 20000)]);
    const body = {
      model: this.config.model, messages: openRouterMessages(messages), stream: false, max_tokens: this.config.maxTokens,
      provider: { require_parameters: true, sort: this.config.sort ?? "latency" },
      ...(this.config.reasoningEffort ? { reasoning: { effort: this.config.reasoningEffort } } : {}),
      // Some tool-capable providers (including Gemini) do not support parallel_tool_calls.
      // With require_parameters it excludes those providers even when false. The agent
      // executes returned calls sequentially and stops at an offer or completion itself.
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      ...(format ? { response_format: { type: "json_schema", json_schema: { name: "voice_response", strict: true,
        schema: isObject(format) && format.type === "object" ? { ...format, additionalProperties: false } : format } } } : {}),
    };
    let response: Response;
    try {
      response = await this.fetchChat(endpoint, { method: "POST", redirect: "error", signal: requestSignal,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "X-OpenRouter-Title": "El Turno Workbench" }, body: JSON.stringify(body) });
    } catch {
      signal.throwIfAborted();
      throw new Error(requestSignal.aborted ? "OpenRouter request timed out" : "OpenRouter request failed; check the network connection");
    }
    if (!response.ok) {
      const hint: Record<number, string> = { 401: "update OPENROUTER_API_KEY in .env or the key in Setup", 402: "check OpenRouter credits", 429: "rate limited; try again later", 400: "check model tool/structured-output support", 404: "no matching endpoint; check OPENROUTER_MODEL, required tool/structured-output support, and OpenRouter provider/privacy settings" };
      if (response.status === 404) {
        // Classify a known routing error, but never echo upstream text or metadata:
        // those can contain credentials, patient data or prompts.
        try {
          const body: unknown = await response.json();
          if (isObject(body) && isObject(body.error) && typeof body.error.message === "string"
            && /^No endpoints found matching your data policy\b/i.test(body.error.message))
            hint[404] = "no endpoints match your account data policy; select an allowed model with SIM_CALLER_MODEL (simulator) or OPENROUTER_MODEL";
        } catch { /* Keep the generic routing diagnostic for unknown/non-JSON bodies. */ }
      }
      throw new Error(`OpenRouter HTTP ${response.status}: ${hint[response.status] ?? "provider request failed"} (model: ${this.config.model})`);
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error("OpenRouter returned invalid JSON"); }
    requestSignal.throwIfAborted();
    const metrics: Record<string, number | string> = {};
    if (isObject(data)) {
      // Only allow operational metadata into reports, never provider text or reasoning.
      for (const field of ["provider", "model", "id"])
        if (typeof data[field] === "string" && /^[a-zA-Z0-9 /_.:-]{1,160}$/.test(data[field])) metrics[field] = data[field];
      if (isObject(data.usage)) {
        for (const field of ["prompt_tokens", "completion_tokens", "total_tokens"])
          if (typeof data.usage[field] === "number" && Number.isFinite(data.usage[field]) && data.usage[field] >= 0) metrics[field] = data.usage[field];
        const details = data.usage.completion_tokens_details;
        if (isObject(details) && typeof details.reasoning_tokens === "number" && Number.isFinite(details.reasoning_tokens) && details.reasoning_tokens >= 0)
          metrics.reasoning_tokens = details.reasoning_tokens;
      }
    }
    return { message: parseChatReply(data, "OpenRouter", "OPENROUTER_MAX_TOKENS"), elapsed_ms: Math.round(performance.now() - started), metrics };
  }
}
