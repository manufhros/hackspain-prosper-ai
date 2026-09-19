import { getPublicCase } from "@/lib/cases/load";
import { runVoiceCall, type VoiceSimEvent } from "@/lib/voice/run-call";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const DEFAULT_WS = process.env.VOICE_AGENT_WS_URL ?? "wss://b5f4-86-127-225-103.ngrok-free.app/ws";

export async function POST(request: Request) {
  const body = (await request.json()) as { caseId?: string; endpoint?: string };
  const item = body.caseId ? getPublicCase(body.caseId) : undefined;
  if (!item) return Response.json({ error: "unknown case" }, { status: 404 });
  const endpoint = (body.endpoint || DEFAULT_WS).trim();
  if (!/^wss?:\/\//.test(endpoint)) {
    return Response.json({ error: "endpoint must be ws:// or wss://" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: VoiceSimEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runVoiceCall({
          item,
          endpoint,
          emit: send,
          signal: request.signal,
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          send({
            type: "error",
            error: error instanceof Error ? error.message : "voice simulation failed",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
