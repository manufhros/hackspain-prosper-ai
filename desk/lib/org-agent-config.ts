import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSetting, usesCloudflareStorage, writeSetting } from "./cloudflare-storage";
import { PROSPER_API_BASE } from "./endpoint-health";
import { HOSPITAL_FAQ, hospitalProfile } from "./hospital-profile";
import { DEFAULT_VOICE_ID } from "./voices";
export { PROSPER_API_BASE } from "./endpoint-health";
export { HOSPITAL_FAQ } from "./hospital-profile";

export type EndpointHealth = {
  status: "unknown" | "healthy" | "degraded" | "down";
  checkedAt: string | null;
  latencyMs: number | null;
  statusCode: number | null;
  message: string | null;
};

export type OrgAgentConfig = {
  orgSlug: string;
  preCallEndpoint: string;
  actionEndpoint: string;
  postCallEndpoint: string;
  frustrationThreshold: number;
  faq: Array<{ id: string; question: string; answer: string }>;
  metaPrompt: string;
  extraInstructions: string;
  firstMessage: string;
  firstMessageEn: string;
  language: string;
  voiceId: string;
  health: Record<"preCall" | "actions" | "postCall", EndpointHealth>;
  updatedAt: string | null;
  updatedBy: string | null;
};

const FILE = path.resolve(process.cwd(), "..", "data", "org-agent-config.json");
const EMPTY_HEALTH: EndpointHealth = {
  status: "unknown",
  checkedAt: null,
  latencyMs: null,
  statusCode: null,
  message: null,
};

export function defaultOrgAgentConfig(orgSlug: string): OrgAgentConfig {
  const profile = hospitalProfile(orgSlug);
  return {
    orgSlug,
    preCallEndpoint: `${PROSPER_API_BASE}/directory`,
    actionEndpoint: `${PROSPER_API_BASE}/availability`,
    postCallEndpoint: `${PROSPER_API_BASE}/submissions`,
    frustrationThreshold: 75,
    faq: HOSPITAL_FAQ.map((item) => ({ ...item })),
    metaPrompt: profile.metaPrompt,
    extraInstructions: profile.extraInstructions,
    firstMessage: "{{clinic_name}}, buenos días. ¿En qué puedo ayudarle?",
    firstMessageEn: "{{clinic_name}}, hello. How may I help you?",
    language: "es",
    voiceId: DEFAULT_VOICE_ID,
    health: {
      preCall: { ...EMPTY_HEALTH },
      actions: { ...EMPTY_HEALTH },
      postCall: { ...EMPTY_HEALTH },
    },
    updatedAt: null,
    updatedBy: null,
  };
}

async function readAll(): Promise<Record<string, OrgAgentConfig>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Record<string, OrgAgentConfig>;
  } catch {
    return {};
  }
}

async function writeAll(value: Record<string, OrgAgentConfig>) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, FILE);
}

export async function readOrgAgentConfig(orgSlug: string): Promise<OrgAgentConfig> {
  const defaults = defaultOrgAgentConfig(orgSlug);
  const saved = usesCloudflareStorage()
    ? await readSetting<OrgAgentConfig>(`org-agent-config:${orgSlug}`)
    : (await readAll())[orgSlug];
  const merged = { ...defaults, ...saved, orgSlug };
  return {
    ...merged,
    preCallEndpoint: merged.preCallEndpoint.trim() || defaults.preCallEndpoint,
    actionEndpoint: merged.actionEndpoint.trim() || defaults.actionEndpoint,
    postCallEndpoint: merged.postCallEndpoint.trim() || defaults.postCallEndpoint,
    faq: merged.faq.length ? merged.faq : defaults.faq,
    metaPrompt: String(merged.metaPrompt ?? "").trim() || defaults.metaPrompt,
    extraInstructions: String(merged.extraInstructions ?? "").trim() || defaults.extraInstructions,
    firstMessage: String(merged.firstMessage ?? "").trim() || defaults.firstMessage,
    firstMessageEn: String(merged.firstMessageEn ?? "").trim() || defaults.firstMessageEn,
    language: String(merged.language ?? "es").trim() || "es",
    voiceId: String(merged.voiceId ?? defaults.voiceId).trim() || defaults.voiceId,
  };
}

export async function saveOrgAgentConfig(config: OrgAgentConfig): Promise<void> {
  if (usesCloudflareStorage()) return writeSetting(`org-agent-config:${config.orgSlug}`, config);
  const all = await readAll();
  all[config.orgSlug] = config;
  await writeAll(all);
}
