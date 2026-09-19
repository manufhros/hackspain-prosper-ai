import type { TranscriptTurn } from "@/lib/cases/transcript";

const SKIP_TOOLS = new Set([
  "language_detection",
  "play_keypad_touch_tone",
  "contextual_update",
]);

type ToolCall = {
  request_id?: string;
  tool_name?: string;
  params_as_json?: string;
  tool_has_been_called?: boolean;
};

type ToolResult = {
  request_id?: string;
  tool_name?: string;
  result_value?: string;
  is_error?: boolean;
};

type TranscriptEntry = {
  role?: string;
  message?: string | null;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  reasoning?: Array<{ summary?: string | null }>;
  time_in_call_secs?: number;
};

type ConversationListItem = {
  conversation_id?: string;
  status?: string;
  start_time_unix_secs?: number;
};

type ConversationDetail = {
  conversation_id?: string;
  status?: string;
  transcript?: TranscriptEntry[];
  conversation_initiation_client_data?: {
    dynamic_variables?: Record<string, unknown>;
  };
};

function fieldsFromJson(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { raw };
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
    );
  } catch {
    return raw ? { raw } : {};
  }
}

function resultText(raw?: string) {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "summary" in parsed) {
      return String((parsed as { summary: unknown }).summary);
    }
    if (typeof parsed === "string") return parsed;
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function headers() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  return { "xi-api-key": key };
}

function agentId() {
  const id = process.env.ELEVENLABS_AGENT_ID;
  if (!id) throw new Error("ELEVENLABS_AGENT_ID missing");
  return id;
}

async function elevenGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  const data = (await response.json()) as T & { detail?: unknown };
  if (!response.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "elevenlabs request failed");
  }
  return data;
}

export function turnsFromConversation(detail: ConversationDetail, lastSpeech = ""): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let spoken = lastSpeech;
  const prefix = detail.conversation_id ?? "el";
  let index = 0;

  for (const entry of detail.transcript ?? []) {
    const reason = entry.reasoning?.map((item) => item.summary).find(Boolean) ?? "";
    const text = String(entry.message ?? "").trim();
    if (text) {
      const role = entry.role === "user" || entry.role === "patient" ? "patient" : "agent";
      spoken = text;
      turns.push({
        id: `${prefix}-msg-${index}`,
        kind: "message",
        role,
        text,
        source: role === "agent" ? "voice-agent" : "caller",
      });
      index += 1;
    }
    for (const call of entry.tool_calls ?? []) {
      const name = String(call.tool_name ?? "tool");
      if (SKIP_TOOLS.has(name)) continue;
      const result = (entry.tool_results ?? []).find(
        (item) => item.request_id === call.request_id || item.tool_name === name,
      );
      turns.push({
        id: `${prefix}-tool-${call.request_id ?? index}`,
        kind: "tool",
        name,
        reason: reason || (spoken ? `Después de: «${spoken.slice(0, 90)}»` : "Durante la llamada"),
        input: fieldsFromJson(call.params_as_json),
        result: resultText(result?.result_value) || (result?.is_error ? "error" : ""),
      });
      index += 1;
    }
  }

  return turns;
}

export async function findVoiceTrace(options: {
  callId: string;
  sinceUnix: number;
  fromNumber?: string;
  conversationId?: string;
}): Promise<{ conversationId?: string; status: string; turns: TranscriptTurn[] }> {
  if (options.conversationId) {
    const detail = await elevenGet<ConversationDetail>(
      `/v1/convai/conversations/${options.conversationId}`,
    );
    return {
      conversationId: detail.conversation_id,
      status: detail.status ?? "unknown",
      turns: turnsFromConversation(detail),
    };
  }

  const listed = await elevenGet<{ conversations?: ConversationListItem[] }>(
    `/v1/convai/conversations?agent_id=${encodeURIComponent(agentId())}&page_size=15`,
  );
  const recent = (listed.conversations ?? [])
    .filter((item) => (item.start_time_unix_secs ?? 0) >= options.sinceUnix)
    .sort((a, b) => (b.start_time_unix_secs ?? 0) - (a.start_time_unix_secs ?? 0));

  let matched: ConversationDetail | undefined;
  for (const item of recent) {
    if (!item.conversation_id) continue;
    const detail = await elevenGet<ConversationDetail>(
      `/v1/convai/conversations/${item.conversation_id}`,
    );
    const vars = detail.conversation_initiation_client_data?.dynamic_variables ?? {};
    const callId = String(vars.call_id ?? "");
    const fromNumber = String(vars.from_number ?? "");
    if (callId && callId === options.callId) {
      matched = detail;
      break;
    }
    if (options.fromNumber && fromNumber && fromNumber === options.fromNumber) {
      matched = detail;
      break;
    }
  }
  if (!matched) {
    const live = recent.find((item) => item.status && item.status !== "done") ?? recent[0];
    if (live?.conversation_id) {
      matched = await elevenGet<ConversationDetail>(
        `/v1/convai/conversations/${live.conversation_id}`,
      );
    }
  }
  if (!matched) return { status: "waiting", turns: [] };
  return {
    conversationId: matched.conversation_id,
    status: matched.status ?? "unknown",
    turns: turnsFromConversation(matched),
  };
}
