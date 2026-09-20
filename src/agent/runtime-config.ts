import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_PROMPT } from "./prompt.ts";

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
  metaPrompt: string;
  extraInstructions: string;
  firstMessage: string;
  firstMessageEn: string;
  language: string;
  voiceId: string;
};

type StoredOrg = Partial<RuntimeConfig>;

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
  metaPrompt: "None.",
  extraInstructions: "None.",
  firstMessage: "{{clinic_name}}, buenos días. ¿En qué puedo ayudarle?",
  firstMessageEn: "{{clinic_name}}, hello. How may I help you?",
  language: "es",
  voiceId: "UOIqAnmS11Reiei1Ytkc",
};

export async function loadRuntimeConfig(orgSlug = "arenal"): Promise<RuntimeConfig> {
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
  let orgConfig: StoredOrg = {};
  try {
    const all = JSON.parse(
      await readFile(join(process.cwd(), "data", "org-agent-config.json"), "utf8"),
    ) as Record<string, StoredOrg>;
    orgConfig = all[orgSlug] ?? {};
  } catch {
    orgConfig = {};
  }
  return mergeRuntimeConfig(parsed, orgConfig);
}

export function mergeRuntimeConfig(
  parsed: { active?: { id?: string; config?: Partial<Omit<RuntimeConfig, "version">> } },
  orgConfig: StoredOrg,
): RuntimeConfig {
  const config = parsed.active?.config ?? {};
  const meta = String(orgConfig.metaPrompt ?? "").trim();
  const extra = String(orgConfig.extraInstructions ?? "").trim();
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...config,
    version: parsed.active?.id ?? "defaults",
    escalationFails: Math.min(5, Math.max(1, Number(orgConfig.escalationFails ?? config.escalationFails ?? 3))),
    frustrationThreshold: Math.min(
      100,
      Math.max(50, Number(orgConfig.frustrationThreshold ?? config.frustrationThreshold ?? 75)),
    ),
    preCallEndpoint: orgConfig.preCallEndpoint ?? "",
    postCallEndpoint: orgConfig.postCallEndpoint ?? "",
    faq: Array.isArray(orgConfig.faq) && orgConfig.faq.length
      ? orgConfig.faq
      : Array.isArray(config.faq) ? config.faq : [],
    metaPrompt: meta || "None.",
    extraInstructions: extra || "None.",
    firstMessage: String(orgConfig.firstMessage ?? config.firstMessage ?? DEFAULT_RUNTIME_CONFIG.firstMessage),
    firstMessageEn: String(orgConfig.firstMessageEn ?? DEFAULT_RUNTIME_CONFIG.firstMessageEn),
    language: String(orgConfig.language ?? config.language ?? "es"),
    voiceId: String(config.voiceId ?? orgConfig.voiceId ?? DEFAULT_RUNTIME_CONFIG.voiceId),
  };
}

export function applyAgentPrompt(runtime: RuntimeConfig) {
  return AGENT_PROMPT
    .replaceAll("{{meta_prompt}}", runtime.metaPrompt)
    .replaceAll("{{org_instructions}}", runtime.extraInstructions);
}

export function conversationConfigOverride(runtime: RuntimeConfig) {
  return {
    agent: {
      first_message: runtime.firstMessage,
      language: runtime.language,
      prompt: {
        prompt: applyAgentPrompt(runtime),
      },
    },
    tts: {
      voice_id: runtime.voiceId,
    },
  };
}
