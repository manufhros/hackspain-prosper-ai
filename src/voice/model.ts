import { MODEL } from "./assets";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export type ModelConfig = { provider: "local"; model: string } | { provider: "openrouter"; model: string; maxTokens: number; timeoutMs?: number; reasoningEffort?: ReasoningEffort; sort?: "latency" | "price" | "throughput" };
export const openRouterKeyIdentity = { service: "el-turno-openrouter", name: "https://openrouter.ai" };

export function modelConfig(env: Record<string, string | undefined> = process.env): ModelConfig {
  const provider = env.LLM_PROVIDER?.trim() || "local";
  if (provider === "local") return { provider, model: MODEL };
  if (provider !== "openrouter") throw new Error("LLM_PROVIDER must be local or openrouter");
  const model = env.OPENROUTER_MODEL?.trim();
  if (!model || model.length > 200 || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:/-]+$/.test(model))
    throw new Error("Set OPENROUTER_MODEL to an OpenRouter model ID (provider/model) supporting tools and structured outputs");
  const maxTokens = Number(env.OPENROUTER_MAX_TOKENS || "4096");
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 32768) throw new Error("OPENROUTER_MAX_TOKENS must be an integer from 256 to 32768");
  const timeoutMs = Number(env.OPENROUTER_TIMEOUT_MS || "20000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error("OPENROUTER_TIMEOUT_MS must be 1000–120000");
  const sort = env.OPENROUTER_PROVIDER_SORT?.trim() || "latency";
  if (!["latency", "price", "throughput"].includes(sort)) throw new Error("OPENROUTER_PROVIDER_SORT must be latency, price or throughput");
  const effort = env.OPENROUTER_REASONING_EFFORT?.trim() || "auto";
  if (!["auto", "default", "none", "minimal", "low", "medium", "high"].includes(effort)) throw new Error("Invalid OPENROUTER_REASONING_EFFORT");
  // Avoid requiring reasoning support on arbitrary models. Gemini 3 supports low effort.
  const reasoningEffort = effort === "auto" ? (/^google\/gemini-3[.-]/.test(model) ? "low" : undefined)
    : effort === "default" ? undefined : effort as ReasoningEffort;
  return { provider, model, maxTokens, timeoutMs, sort: sort as "latency" | "price" | "throughput", ...(reasoningEffort ? { reasoningEffort } : {}) };
}

export async function openRouterKey(
  read: (identity: typeof openRouterKeyIdentity) => Promise<string | null> = identity => Bun.secrets.get(identity),
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const key = env.OPENROUTER_API_KEY?.trim() || (await read(openRouterKeyIdentity))?.trim();
  if (!key) throw new Error("Set OPENROUTER_API_KEY in .env or save a key in Setup → OpenRouter API key (bun start --offline), then restart");
  if (key.length > 512 || /\s/.test(key)) throw new Error("Invalid OpenRouter API key; update OPENROUTER_API_KEY in .env or the Keychain entry in Setup");
  return key;
}

export function runtimeExecutables(config: ModelConfig, backend: "llama" | "ollama" = "llama", recognitionOnly = false): string[] {
  return config.provider === "local" && !recognitionOnly ? ["uv", backend === "llama" ? "llama-server" : "ollama"] : ["uv"];
}

export function childEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const { PLATFORM_API_KEY: _clinic, VOICE_SERVER_TOKEN: _server, OPENROUTER_API_KEY: _router, ...safe } = env;
  return safe;
}
