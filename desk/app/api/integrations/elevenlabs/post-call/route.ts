import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function validSignature(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2)));
  const timestamp = parts.t;
  const supplied = parts.v0;
  if (!timestamp || !supplied) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  if (secret && !validSignature(raw, request.headers.get("elevenlabs-signature"), secret)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const data = (body.data ?? body) as Record<string, unknown>;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const variables = (metadata.dynamic_variables ?? data.dynamic_variables ?? {}) as Record<
    string,
    unknown
  >;
  const analysis = (data.analysis ?? {}) as Record<string, unknown>;
  const record = {
    receivedAt: new Date().toISOString(),
    eventType: body.type ?? body.event_type ?? "post_call",
    callId: variables.call_id ?? data.call_id ?? null,
    conversationId: data.conversation_id ?? null,
    status: data.status ?? null,
    analysis,
    metadata: {
      startTime: metadata.start_time_unix_secs ?? null,
      callDurationSecs: metadata.call_duration_secs ?? null,
      cost: metadata.cost ?? null,
    },
  };
  const file = path.resolve(process.cwd(), "..", "data", "elevenlabs-postcall.jsonl");
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return NextResponse.json({ received: true });
}
