import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSetting, usesCloudflareStorage, writeSetting } from "./cloudflare-storage";
import { PROSPER_API_BASE } from "./endpoint-health";
import { HOSPITAL_FAQ, hospitalProfile } from "./hospital-profile";
import { hooksFromRoutes, routesFromConfig } from "./prosper-endpoints";
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
  routes: Record<string, string>;
  frustrationThreshold: number;
  escalationFails: number;
  faq: Array<{ id: string; question: string; answer: string }>;
  metaPrompt: string;
  extraInstructions: string;
  firstMessage: string;
  firstMessageEn: string;
  language: string;
  voiceId: string;
  health: Record<"preCall" | "actions" | "postCall", EndpointHealth>;
  routeHealth: Record<string, EndpointHealth>;
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
    routes: routesFromConfig({}),
    frustrationThreshold: 75,
    escalationFails: 3,
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
    routeHealth: {},
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

function mergeFaq(
  saved: OrgAgentConfig["faq"],
  defaults: OrgAgentConfig["faq"],
): OrgAgentConfig["faq"] {
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const defaultIds = new Set(defaults.map((item) => item.id));
  const next = defaults.map((item) => {
    const existing = savedById.get(item.id);
    if (!existing) return { ...item };
    if (/red de demostración|Nueva Mutua/i.test(existing.answer)) return { ...item };
    return {
      id: item.id,
      question: existing.question.trim() || item.question,
      answer: existing.answer.trim() || item.answer,
    };
  });
  return [
    ...next,
    ...saved.filter((item) => !defaultIds.has(item.id) && item.question.trim() && item.answer.trim()),
  ];
}

export async function readOrgAgentConfig(orgSlug: string): Promise<OrgAgentConfig> {
  const defaults = defaultOrgAgentConfig(orgSlug);
  const saved = usesCloudflareStorage()
    ? await readSetting<OrgAgentConfig>(`org-agent-config:${orgSlug}`)
    : (await readAll())[orgSlug];
  const merged = { ...defaults, ...saved, orgSlug };
  const routes = routesFromConfig(merged);
  const hooks = hooksFromRoutes(routes);
  return {
    ...merged,
    ...hooks,
    routes,
    faq: mergeFaq(merged.faq, defaults.faq),
    metaPrompt: String(merged.metaPrompt ?? "").trim() || defaults.metaPrompt,
    extraInstructions: String(merged.extraInstructions ?? "").trim() || defaults.extraInstructions,
    firstMessage: String(merged.firstMessage ?? "").trim() || defaults.firstMessage,
    firstMessageEn: String(merged.firstMessageEn ?? "").trim() || defaults.firstMessageEn,
    language: String(merged.language ?? "es").trim() || "es",
    voiceId: String(merged.voiceId ?? defaults.voiceId).trim() || defaults.voiceId,
    frustrationThreshold: Math.min(100, Math.max(50, Number(merged.frustrationThreshold) || defaults.frustrationThreshold)),
    escalationFails: Math.min(5, Math.max(1, Math.round(Number(merged.escalationFails) || defaults.escalationFails))),
    routeHealth: { ...defaults.routeHealth, ...merged.routeHealth },
  };
}

export async function saveOrgAgentConfig(config: OrgAgentConfig): Promise<void> {
  if (usesCloudflareStorage()) return writeSetting(`org-agent-config:${config.orgSlug}`, config);
  const all = await readAll();
  all[config.orgSlug] = config;
  await writeAll(all);
}
