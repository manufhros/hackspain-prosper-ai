import { MODEL } from "./assets";

export type ModelConfig = { provider: "local"; model: string } | { provider: "openrouter"; model: string; maxTokens: number };
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
  return { provider, model, maxTokens };
}

export async function openRouterKey(read: (identity: typeof openRouterKeyIdentity) => Promise<string | null> = identity => Bun.secrets.get(identity)): Promise<string> {
  const key = (await read(openRouterKeyIdentity))?.trim();
  if (!key) throw new Error("Save an OpenRouter API key in Setup → OpenRouter API key (bun start --offline), then restart");
  if (key.length > 512 || /\s/.test(key)) throw new Error("The OpenRouter Keychain entry is not a valid API key; update it in Setup");
  return key;
}

export function runtimeExecutables(config: ModelConfig): string[] { return config.provider === "local" ? ["uv", "ollama"] : ["uv"]; }

export function childEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const { PLATFORM_API_KEY: _clinic, VOICE_SERVER_TOKEN: _server, OPENROUTER_API_KEY: _router, ...safe } = env;
  return safe;
}
