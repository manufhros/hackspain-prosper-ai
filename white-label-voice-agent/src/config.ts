function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env`);
  return value;
}

/**
 * Mismos nombres que la rama de Lucía para `platform*`, porque `platform/client.ts`
 * está portado verbatim de allí y los consume tal cual.
 */
export const env = {
  platformApiKey: required("PLATFORM_API_KEY"),
  platformApiBaseUrl: (
    process.env.PLATFORM_API_BASE_URL ?? "https://hackspain.getprosperapp.com"
  ).replace(/\/$/, ""),
  port: Number(process.env.PORT ?? 7861),
};

/** El gateway acepta AI_GATEWAY_API_KEY o el OIDC de `vercel env pull`. */
export function assertGatewayAuth(): void {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error(
      "AI Gateway auth missing. Set AI_GATEWAY_API_KEY (or run `vercel env pull` for VERCEL_OIDC_TOKEN).",
    );
  }
}

export const models = {
  chat: process.env.WL_CHAT_MODEL ?? "openai/gpt-5.6-luna-fast", // barato ($0.40 vs $4 de sol) y baja latencia; iguala/supera a sol en el eval
  caller: process.env.WL_CALLER_MODEL ?? "openai/gpt-5.6-luna", // simulador de paciente: barato

  stt: process.env.WL_STT_MODEL ?? "openai/whisper-1",
  tts: process.env.WL_TTS_MODEL ?? "openai/tts-1-hd",
  ttsVoice: process.env.WL_TTS_VOICE ?? "nova",
};
