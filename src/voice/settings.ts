/** One bounded capacity configuration for the Mac's shared inference resources. */
export function localSettings(env: Record<string, string | undefined> = process.env) {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = env[name]?.trim() || String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be ${min}–${max}`);
    return Number(value);
  };
  const asrModel = env.LOCAL_ASR_MODEL?.trim() || "small";
  if (!["small", "large-v3-turbo"].includes(asrModel)) throw new Error("LOCAL_ASR_MODEL must be small or large-v3-turbo");
  return {
    parallel: integer("LOCAL_LLM_PARALLEL", 4, 1, 8),
    context: integer("LOCAL_LLM_CONTEXT", 8192, 4096, 32768),
    maxTokens: integer("LOCAL_LLM_MAX_TOKENS", 512, 128, 2048),
    ttsWorkers: integer("LOCAL_TTS_WORKERS", 2, 1, 4),
    ttsThreads: integer("LOCAL_TTS_THREADS", 2, 1, 4),
    asrModel: asrModel as "small" | "large-v3-turbo",
  };
}
export type LocalSettings = ReturnType<typeof localSettings>;
