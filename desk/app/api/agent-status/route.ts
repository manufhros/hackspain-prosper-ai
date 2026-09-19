import { agentHealth } from "@/lib/agent-health";
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { usesCloudflareStorage } from "@/lib/cloudflare-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const endpoint = process.env.VOICE_AGENT_HEALTH_URL ?? "http://127.0.0.1:7860/health";
  const checkedAt = new Date().toISOString();
  try {
    const response = usesCloudflareStorage()
      ? await getCloudflareContext().env.VOICE_AGENT.fetch("https://voice.internal/health", {
          signal: AbortSignal.timeout(1_500),
        })
      : await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return NextResponse.json(agentHealth(await response.json(), checkedAt));
  } catch {
    return NextResponse.json(agentHealth(null, checkedAt));
  }
}
