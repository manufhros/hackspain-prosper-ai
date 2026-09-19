function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env`);
  }
  return value;
}

// Read secrets when a request uses them, after Workers has populated process.env.
export const env = {
  get platformApiKey() { return required("PLATFORM_API_KEY"); },
  get platformApiBaseUrl() {
    return (process.env.PLATFORM_API_BASE_URL ?? "https://hackspain.getprosperapp.com").replace(/\/$/, "");
  },
  get elevenLabsApiKey() { return required("ELEVENLABS_API_KEY"); },
  get elevenLabsAgentId() { return required("ELEVENLABS_AGENT_ID"); },
  get port() { return Number(process.env.PORT ?? 7860); },
};
