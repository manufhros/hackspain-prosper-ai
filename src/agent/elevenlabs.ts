import { env } from "../config.ts";

export async function getSignedConversationUrl(
  credentials = {
    apiKey: env.elevenLabsApiKey,
    agentId: env.elevenLabsAgentId,
  },
): Promise<string> {
  if (!credentials.apiKey || !credentials.agentId)
    throw new Error("Configure ElevenLabs in console settings");
  const url = new URL(
    "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
  );
  url.searchParams.set("agent_id", credentials.agentId);
  let lastError = "signed url failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, 200 * 2 ** (attempt - 1)),
      );
    }
    const response = await fetch(url, {
      headers: { "xi-api-key": credentials.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const body = (await response.json()) as { signed_url: string };
      return body.signed_url;
    }
    lastError = `ElevenLabs signed URL ${response.status}: ${await response.text()}`;
    if (response.status !== 429 && response.status < 500) break;
  }
  throw new Error(lastError);
}

export const CLIENT_EVENTS = [
  "audio",
  "interruption",
  "agent_response",
  "user_transcript",
  "agent_response_correction",
  "client_tool_call",
  "agent_tool_request",
  "agent_tool_response",
  "conversation_initiation_metadata",
  "ping",
] as const;

export type ClientToolCall = {
  tool_name: string;
  tool_call_id: string;
  parameters: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asParams(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asParams(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return asRecord(value) ?? {};
}

export function extractClientToolCall(
  value: unknown,
): ClientToolCall | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const nested = asRecord(record.client_tool_call);
  if (!nested) return undefined;
  const tool_name =
    typeof nested.tool_name === "string" ? nested.tool_name : "";
  const tool_call_id =
    typeof nested.tool_call_id === "string" ? nested.tool_call_id : "";
  if (!tool_name || !tool_call_id) return undefined;
  return { tool_name, tool_call_id, parameters: asParams(nested.parameters) };
}
