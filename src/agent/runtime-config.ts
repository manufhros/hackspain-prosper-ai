import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type RuntimeConfig = {
  version: string;
  patientLookup: boolean;
  dynamicContext: boolean;
  actionTools: boolean;
  postCallWebhook: boolean;
  zeroRetention: boolean;
  escalationFails: number;
  frustrationThreshold: number;
  routingMode: "shadow" | "enforce";
  preCallEndpoint: string;
  postCallEndpoint: string;
  faq: Array<{ question: string; answer: string }>;
};

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  version: "defaults",
  patientLookup: true,
  dynamicContext: true,
  actionTools: true,
  postCallWebhook: false,
  zeroRetention: true,
  escalationFails: 3,
  frustrationThreshold: 75,
  routingMode: "shadow",
  preCallEndpoint: "",
  postCallEndpoint: "",
  faq: [],
};

export async function loadRuntimeConfig(orgSlug = "arenal"): Promise<RuntimeConfig> {
  let parsed: {
    active?: {
      id?: string;
      config?: Partial<Omit<RuntimeConfig, "version">>;
    };
  } = {};
  try {
    parsed = JSON.parse(
      await readFile(join(process.cwd(), "data", "agent-config.json"), "utf8"),
    );
  } catch {
    parsed = {};
  }
  let orgConfig: {
    preCallEndpoint?: string;
    postCallEndpoint?: string;
    frustrationThreshold?: number;
    faq?: Array<{ question: string; answer: string }>;
  } = {};
  try {
    const all = JSON.parse(
      await readFile(join(process.cwd(), "data", "org-agent-config.json"), "utf8"),
    ) as Record<string, typeof orgConfig>;
    orgConfig = all[orgSlug] ?? {};
  } catch {
    orgConfig = {};
  }
  return mergeRuntimeConfig(parsed, orgConfig);
}

export function mergeRuntimeConfig(
  parsed: { active?: { id?: string; config?: Partial<Omit<RuntimeConfig, "version">> } },
  orgConfig: {
    preCallEndpoint?: string;
    postCallEndpoint?: string;
    frustrationThreshold?: number;
    faq?: Array<{ question: string; answer: string }>;
  },
): RuntimeConfig {
  const config = parsed.active?.config ?? {};
  const externalPreCall =
    orgConfig.preCallEndpoint?.includes("hackspain.getprosperapp.com")
      ? ""
      : (orgConfig.preCallEndpoint ?? "");
  const externalPostCall =
    orgConfig.postCallEndpoint?.includes("hackspain.getprosperapp.com")
      ? ""
      : (orgConfig.postCallEndpoint ?? "");
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...config,
    version: parsed.active?.id ?? "defaults",
    escalationFails: Math.min(5, Math.max(1, Number(config.escalationFails ?? 3))),
    frustrationThreshold: Math.min(
      100,
      Math.max(50, Number(orgConfig.frustrationThreshold ?? config.frustrationThreshold ?? 75)),
    ),
    preCallEndpoint: externalPreCall,
    postCallEndpoint: externalPostCall,
    faq: orgConfig.faq ?? [],
  };
}
