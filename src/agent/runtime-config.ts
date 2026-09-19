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

export async function loadRuntimeConfig(_orgSlug = "arenal"): Promise<RuntimeConfig> {
  let parsed: {
    active?: {
      id?: string;
      config?: Partial<Omit<RuntimeConfig, "version">> & {
        faq?: Array<{ question: string; answer: string }>;
      };
    };
  } = {};
  try {
    parsed = JSON.parse(
      await readFile(join(process.cwd(), "data", "agent-config.json"), "utf8"),
    );
  } catch {
    parsed = {};
  }
  const config = parsed.active?.config ?? {};
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...config,
    version: parsed.active?.id ?? "defaults",
    escalationFails: Math.min(5, Math.max(1, Number(config.escalationFails ?? 3))),
    frustrationThreshold: Math.min(
      100,
      Math.max(50, Number(config.frustrationThreshold ?? 75)),
    ),
    preCallEndpoint: "",
    postCallEndpoint: "",
    faq: Array.isArray(config.faq) ? config.faq : [],
  };
}
