import { NextRequest, NextResponse } from "next/server";
import { CookieExpiredError, prosperFetch, TEAM_ID } from "@/lib/prosper-server";

export const dynamic = "force-dynamic";

// Upstream: GET /leaderboard/teams/{team_id}/audio/{call_id}  (sin prefijo /api/, responde 206)
export async function GET(req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(callId)) {
    return NextResponse.json({ error: "bad_call_id" }, { status: 400 });
  }

  const range = req.headers.get("range");

  try {
    const res = await prosperFetch(`/leaderboard/teams/${TEAM_ID}/audio/${callId}`, {
      headers: range ? { range } : {},
    });

    // Reenviamos solo lo necesario para que <audio> pueda hacer seek
    const headers = new Headers();
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    if (e instanceof CookieExpiredError) {
      return NextResponse.json({ error: "cookie_expired" }, { status: 401 });
    }
    throw e;
  }
}
