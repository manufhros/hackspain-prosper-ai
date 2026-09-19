import "server-only";
import { headers } from "next/headers";
import { usesCloudflareStorage } from "./cloudflare-storage";

export async function voiceAgentWsUrl() {
  const configured = process.env.VOICE_AGENT_WS_URL?.trim() || process.env.VOICE_AGENT_PUBLIC_URL?.trim();
  if (configured) return configured;
  if (usesCloudflareStorage()) {
    const host = (await headers()).get("host");
    if (!host) throw new Error("Missing request host for voice WebSocket");
    return `wss://${host}/ws`;
  }
  return "ws://127.0.0.1:7860/ws";
}
