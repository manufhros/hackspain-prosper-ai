import { findVoiceTrace } from "@/lib/elevenlabs/trace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const callId = url.searchParams.get("callId")?.trim();
  const since = Number(url.searchParams.get("since") ?? "0");
  const fromNumber = url.searchParams.get("from")?.trim() || undefined;
  const conversationId = url.searchParams.get("conversationId")?.trim() || undefined;
  if (!callId) {
    return Response.json({ error: "callId required" }, { status: 400 });
  }
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_AGENT_ID) {
    return Response.json({ error: "elevenlabs env missing", turns: [], status: "unconfigured" }, { status: 503 });
  }
  try {
    const trace = await findVoiceTrace({
      callId,
      conversationId,
      sinceUnix: Number.isFinite(since) ? since : Math.floor(Date.now() / 1000) - 120,
      fromNumber,
    });
    return Response.json(trace);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "trace failed",
        turns: [],
        status: "error",
      },
      { status: 502 },
    );
  }
}
