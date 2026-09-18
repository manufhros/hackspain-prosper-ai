import { PlatformClient, baseUrl, keyIdentity } from "../api";
import { type Config } from "../storage";

export const DEFAULT_PLATFORM = "https://hackspain.getprosperapp.com";
export function environmentPlatform(env: Record<string, string | undefined> = process.env) {
  return { origin: baseUrl(env.PLATFORM_API_BASE_URL?.trim() || DEFAULT_PLATFORM), key: env.PLATFORM_API_KEY?.trim() || null };
}
export async function clinicClient(config: Config, env: Record<string, string | undefined> = process.env): Promise<PlatformClient> {
  const environment = environmentPlatform(env);
  // The .env credential is only used with its own configured origin, never with
  // an unrelated origin left in the TUI's saved configuration.
  const origin = environment.key || env.PLATFORM_API_BASE_URL ? environment.origin : config.origin || DEFAULT_PLATFORM;
  const key = environment.key ?? await Bun.secrets.get(keyIdentity(origin));
  if (!key) throw new Error("Add PLATFORM_API_KEY to .env, then restart bun start (or save the key in Setup). Speech smoke tests work without a clinic key.");
  return new PlatformClient(origin, key);
}
