import { isObject } from "../validation";
import { type Message, type ToolCall } from "./runtime";

export function chatMessages(messages: Message[], label = "Model") {
  const pending = new Set<string>();
  const wire = messages.map(message => {
    if (message.role === "tool") {
      if (!message.tool_call_id || !pending.delete(message.tool_call_id)) throw new Error(`${label} tool result has no matching call ID`);
      return { role: "tool", content: message.content, tool_call_id: message.tool_call_id };
    }
    if (pending.size) throw new Error(`${label} conversation has unanswered tool calls`);
    const calls = message.tool_calls?.map(call => {
      if (!call.id || pending.has(call.id)) throw new Error(`${label} tool call has a missing or duplicate ID`);
      pending.add(call.id);
      return { id: call.id, type: "function", function: { name: call.function.name, arguments: call.arguments_text ?? JSON.stringify(call.function.arguments) } };
    });
    return { role: message.role, content: message.content || (calls?.length ? null : ""),
      ...(calls?.length ? { tool_calls: calls } : {}),
      ...(message.reasoning_details ? { reasoning_details: message.reasoning_details } : {}) };
  });
  if (pending.size) throw new Error(`${label} conversation has unanswered tool calls`);
  return wire;
}

export function parseChatReply(data: unknown, label = "Model", limitSetting = "LOCAL_LLM_MAX_TOKENS"): Message {
  if (!isObject(data) || data.error) throw new Error(`${label} returned a provider error; no model action was executed`);
  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  if (!isObject(choice) || !isObject(choice.message)) throw new Error(`${label} returned no assistant message`);
  if (choice.finish_reason === "length") throw new Error(`${label} response was truncated; increase ${limitSetting}`);
  if (!["stop", "tool_calls"].includes(String(choice.finish_reason))) throw new Error(`${label} did not complete the response successfully`);
  const message = choice.message;
  if (message.role !== "assistant" || message.refusal || (message.content != null && typeof message.content !== "string"))
    throw new Error(`${label} returned an unsupported or refused response`);
  let toolCalls: ToolCall[] | undefined;
  if (message.tool_calls != null) {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 16) throw new Error(`${label} returned malformed tool calls`);
    const ids = new Set<string>();
    toolCalls = message.tool_calls.map(call => {
      if (!isObject(call) || typeof call.id !== "string" || !call.id || ids.has(call.id) || call.type !== "function" || !isObject(call.function)
        || typeof call.function.name !== "string" || !call.function.name || typeof call.function.arguments !== "string") throw new Error(`${label} returned a malformed tool call`);
      ids.add(call.id);
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new Error(`${label} returned invalid JSON tool arguments`); }
      if (!isObject(args)) throw new Error(`${label} tool arguments must be a JSON object`);
      return { id: call.id, arguments_text: call.function.arguments, function: { name: call.function.name, arguments: args } };
    });
  }
  const content = typeof message.content === "string" ? message.content : "";
  if (!content.trim() && !toolCalls?.length) throw new Error(`${label} returned no speech or tool request`);
  if (message.reasoning_details != null && !Array.isArray(message.reasoning_details)) throw new Error(`${label} returned malformed reasoning metadata`);
  return { role: "assistant", content, ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    ...(Array.isArray(message.reasoning_details) ? { reasoning_details: message.reasoning_details } : {}) };
}

