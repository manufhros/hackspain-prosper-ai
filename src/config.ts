function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env`);
  }
  return value;
}

export const env = {
  platformApiKey: required("PLATFORM_API_KEY"),
  platformApiBaseUrl: (
    process.env.PLATFORM_API_BASE_URL ?? "https://hackspain.getprosperapp.com"
  ).replace(/\/$/, ""),
  elevenLabsApiKey: required("ELEVENLABS_API_KEY"),
  elevenLabsAgentId: required("ELEVENLABS_AGENT_ID"),
  port: Number(process.env.PORT ?? 7860),
};
