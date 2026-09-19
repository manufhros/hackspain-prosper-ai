import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const endpoint = process.env.VOICE_AGENT_HEALTH_URL ?? "http://127.0.0.1:7860/health";
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json() as {
      ok?: boolean;
      activeCalls?: number;
      uptimeSeconds?: number;
      checkedAt?: string;
    };
    return NextResponse.json({
      ok: health.ok === true,
      activeCalls: health.activeCalls ?? 0,
      uptimeSeconds: health.uptimeSeconds ?? 0,
      checkedAt: health.checkedAt ?? checkedAt,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      activeCalls: 0,
      uptimeSeconds: 0,
      checkedAt,
      error: error instanceof Error ? error.message : "No disponible",
    });
  }
}
