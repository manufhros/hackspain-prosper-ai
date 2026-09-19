export function voiceAgentWsUrl() {
  return process.env.VOICE_AGENT_WS_URL?.trim()
    || process.env.VOICE_AGENT_PUBLIC_URL?.trim()
    || "ws://127.0.0.1:7860/ws";
}
