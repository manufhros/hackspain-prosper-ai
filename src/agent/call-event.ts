import { createHmac, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AuditAction } from "./audit.ts";

const EVENT_DIR = join(process.cwd(), "logs");
const EVENT_FILE = join(EVENT_DIR, "call-events.jsonl");

export type CallEvent = {
  eventId: string;
  schemaVersion: 1;
  type: string;
  occurredAt: string;
  callId: string;
  configVersion: string;
  payload: Record<string, unknown>;
};

export function emitCallEvent(
  type: string,
  callId: string,
  configVersion: string,
  payload: Record<string, unknown> = {},
): CallEvent {
  const event: CallEvent = {
    eventId: randomUUID(),
    schemaVersion: 1,
    type,
    occurredAt: new Date().toISOString(),
    callId,
    configVersion,
    payload,
  };
  void mkdir(EVENT_DIR, { recursive: true })
    .then(() => appendFile(EVENT_FILE, `${JSON.stringify(event)}\n`))
    .catch((error: unknown) => console.error("call-event write failed", error));
  return event;
}

export type PostCallSummary = {
  callId: string;
  configVersion: string;
  outcome: string;
  reason?: string;
  route?: string;
  intent?: string;
  durationMs: number;
  userTurns: number;
  toolCalls: number;
  toolErrors: number;
  frustrationScore: number;
  zeroRetention: boolean;
};

export async function deliverPostCall(
  summary: PostCallSummary,
  configuredEndpoint?: string,
  audit?: AuditAction,
): Promise<void> {
  const endpoint = configuredEndpoint?.trim() || process.env.POST_CALL_WEBHOOK_URL?.trim();
  if (!endpoint) return;
  const body = JSON.stringify({
    event: "call.completed",
    idempotencyKey: `${summary.callId}:postcall:v1`,
    ...summary,
  });
  const secret = process.env.POST_CALL_WEBHOOK_SECRET?.trim();
  const signature = secret
    ? createHmac("sha256", secret).update(body).digest("hex")
    : undefined;
  let lastError = "post-call failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    const requestId = randomUUID();
    await audit?.("webhook.requested", { requestId, attempt: attempt + 1, endpoint, body: summary });
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `${summary.callId}:postcall:v1`,
          ...(signature ? { "x-hash-signature": `sha256=${signature}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      await audit?.("webhook.failed", { requestId, errorType: error instanceof Error ? error.name : "UnknownError" });
      lastError = error instanceof Error ? error.message : lastError;
      continue;
    }
    await audit?.("webhook.completed", { requestId, status: response.status });
    if (response.ok) return;
    lastError = `post-call ${response.status}`;
  }
  throw new Error(lastError);
}
