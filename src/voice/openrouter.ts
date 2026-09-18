import { isObject } from "../validation";
import { type ChatReply, type Message, type ToolCall } from "./runtime";
import { type ModelConfig } from "./model";

type FetchChat = (url: string, init: RequestInit) => Promise<Response>;
const endpoint = "https://openrouter.ai/api/v1/chat/completions";

export function openRouterMessages(messages: Message[]) {
  const pending = new Set<string>();
  const wire = messages.map(message => {
    if (message.role === "tool") {
      if (!message.tool_call_id || !pending.delete(message.tool_call_id)) throw new Error("OpenRouter tool result has no matching call ID");
      return { role: "tool", content: message.content, tool_call_id: message.tool_call_id };
    }
    if (pending.size) throw new Error("OpenRouter conversation has unanswered tool calls");
    const calls = message.tool_calls?.map(call => {
      if (!call.id || pending.has(call.id)) throw new Error("OpenRouter tool call has a missing or duplicate ID");
      pending.add(call.id);
      return { id: call.id, type: "function", function: { name: call.function.name, arguments: call.arguments_text ?? JSON.stringify(call.function.arguments) } };
    });
    return { role: message.role, content: message.content || (calls?.length ? null : ""),
      ...(calls?.length ? { tool_calls: calls } : {}),
      ...(message.reasoning_details ? { reasoning_details: message.reasoning_details } : {}) };
  });
  if (pending.size) throw new Error("OpenRouter conversation has unanswered tool calls");
  return wire;
}

function parseReply(data: unknown): Message {
  if (!isObject(data) || data.error) throw new Error("OpenRouter returned a provider error; no model action was executed");
  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  if (!isObject(choice) || !isObject(choice.message)) throw new Error("OpenRouter returned no assistant message");
  if (choice.finish_reason === "length") throw new Error("OpenRouter response was truncated; increase OPENROUTER_MAX_TOKENS");
  if (!["stop", "tool_calls"].includes(String(choice.finish_reason))) throw new Error("OpenRouter did not complete the response successfully");
  const message = choice.message;
  if (message.role !== "assistant" || message.refusal || (message.content != null && typeof message.content !== "string"))
    throw new Error("OpenRouter returned an unsupported or refused response");
  let toolCalls: ToolCall[] | undefined;
  if (message.tool_calls != null) {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 16) throw new Error("OpenRouter returned malformed tool calls");
    const ids = new Set<string>();
    toolCalls = message.tool_calls.map(call => {
      if (!isObject(call) || typeof call.id !== "string" || !call.id || ids.has(call.id) || call.type !== "function" || !isObject(call.function)
        || typeof call.function.name !== "string" || !call.function.name || typeof call.function.arguments !== "string") throw new Error("OpenRouter returned a malformed tool call");
      ids.add(call.id);
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new Error("OpenRouter returned invalid JSON tool arguments"); }
      if (!isObject(args)) throw new Error("OpenRouter tool arguments must be a JSON object");
      return { id: call.id, arguments_text: call.function.arguments, function: { name: call.function.name, arguments: args } };
    });
  }
  const content = typeof message.content === "string" ? message.content : "";
  if (!content.trim() && !toolCalls?.length) throw new Error("OpenRouter returned no speech or tool request");
  if (message.reasoning_details != null && !Array.isArray(message.reasoning_details)) throw new Error("OpenRouter returned malformed reasoning metadata");
  return { role: "assistant", content, ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    ...(Array.isArray(message.reasoning_details) ? { reasoning_details: message.reasoning_details } : {}) };
}

export class OpenRouterChat {
  constructor(private config: Extract<ModelConfig, { provider: "openrouter" }>, private key: string,
    private fetchChat: FetchChat = (url, init) => fetch(url, init)) {}

  async chat(messages: Message[], tools: unknown[], signal: AbortSignal, format?: unknown): Promise<ChatReply> {
    signal.throwIfAborted();
    const started = performance.now();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
    const body = {
      model: this.config.model, messages: openRouterMessages(messages), stream: false, max_tokens: this.config.maxTokens,
      provider: { require_parameters: true },
      ...(tools.length ? { tools, tool_choice: "auto", parallel_tool_calls: false } : {}),
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
      const hint: Record<number, string> = { 401: "update the API key in Setup", 402: "check OpenRouter credits", 429: "rate limited; try again later", 400: "check model tool/structured-output support", 404: "check OPENROUTER_MODEL and provider support" };
      // Never echo provider bodies: they can contain credentials, patient data or prompts.
      throw new Error(`OpenRouter HTTP ${response.status}: ${hint[response.status] ?? "provider request failed"}`);
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error("OpenRouter returned invalid JSON"); }
    requestSignal.throwIfAborted();
    return { message: parseReply(data), elapsed_ms: Math.round(performance.now() - started) };
  }
}
