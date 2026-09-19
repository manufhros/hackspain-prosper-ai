export const env = {
  platformApiKey: process.env.PLATFORM_API_KEY?.trim() ?? "",
  platformApiBaseUrl: (
    process.env.PLATFORM_API_BASE_URL ?? "https://hackspain.getprosperapp.com"
  ).replace(/\/$/, ""),
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() ?? "",
  elevenLabsAgentId: process.env.ELEVENLABS_AGENT_ID?.trim() ?? "",
  port: Number(process.env.PORT ?? 7860),
};
