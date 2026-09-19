import { env } from "../config.ts";

export async function getSignedConversationUrl(): Promise<string> {
  const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
  url.searchParams.set("agent_id", env.elevenLabsAgentId);
  let lastError = "signed url failed";
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** Math.min(attempt - 1, 4)));
    }
    try {
      const response = await fetch(url, {
        headers: { "xi-api-key": env.elevenLabsApiKey },
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { signed_url: string };
        return body.signed_url;
      }
      lastError = `ElevenLabs signed URL ${response.status}: ${await response.text()}`;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "signed url failed";
    }
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
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
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

const PATIENT_VOICE_ID = process.env.ELEVENLABS_PATIENT_VOICE_ID?.trim() || "XcXEQzuLXRU9RcfWzEJt";
const ULAW_FRAME = 160;

export async function synthesizeMulaw8k(text: string): Promise<string[]> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(PATIENT_VOICE_ID)}?output_format=ulaw_8000`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.elevenLabsApiKey,
        "content-type": "application/json",
        accept: "application/octet-stream",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.32,
          similarity_boost: 0.8,
          style: 0.55,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const raw = Buffer.from(await response.arrayBuffer());
  const frames: string[] = [];
  for (let offset = 0; offset < raw.length; offset += ULAW_FRAME) {
    const slice = raw.subarray(offset, Math.min(raw.length, offset + ULAW_FRAME));
    if (slice.length === ULAW_FRAME) {
      frames.push(slice.toString("base64"));
      continue;
    }
    const padded = Buffer.alloc(ULAW_FRAME, 0xff);
    slice.copy(padded);
    frames.push(padded.toString("base64"));
  }
  return frames;
}

export function extractClientToolCall(value: unknown): ClientToolCall | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const nested = asRecord(record.client_tool_call);
  if (!nested) return undefined;
  const tool_name = typeof nested.tool_name === "string" ? nested.tool_name : "";
  const tool_call_id = typeof nested.tool_call_id === "string" ? nested.tool_call_id : "";
  if (!tool_name || !tool_call_id) return undefined;
  return { tool_name, tool_call_id, parameters: asParams(nested.parameters) };
}
