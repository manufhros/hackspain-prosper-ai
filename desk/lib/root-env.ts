import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

function parseEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match?.[1]) continue;
    result[match[1]] = (match[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return result;
}

function readEnvFile(file: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

let cached: Record<string, string> | null = null;

export function rootEnv(): Record<string, string> {
  if (cached) return cached;
  const cwd = process.cwd();
  cached = {
    ...readEnvFile(path.resolve(cwd, "../../.env")),
    ...readEnvFile(path.resolve(cwd, "../.env")),
    ...readEnvFile(path.resolve(cwd, ".env")),
    ...readEnvFile(path.resolve(cwd, ".env.local")),
  };
  return cached;
}

export function loadLabSecrets() {
  const file = rootEnv();
  const gateway = process.env.AI_GATEWAY_API_KEY ?? file.AI_GATEWAY_API_KEY ?? "";
  const platformKey = process.env.PLATFORM_API_KEY ?? file.PLATFORM_API_KEY ?? "";
  const platformBase = (
    process.env.PLATFORM_API_BASE_URL ??
    file.PLATFORM_API_BASE_URL ??
    "https://hackspain.getprosperapp.com"
  ).replace(/\/$/, "");
  if (gateway) process.env.AI_GATEWAY_API_KEY = gateway;
  return { gateway, platformKey, platformBase };
}
