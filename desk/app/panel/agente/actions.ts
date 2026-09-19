"use server";

import { checkEndpointHealth, safeEndpoint } from "@/lib/endpoint-health";
import { isKnownOrganisation } from "@/lib/orgs";
import { getSession } from "@/lib/session";
import {
  readOrgAgentConfig,
  saveOrgAgentConfig,
  type OrgAgentConfig,
} from "@/lib/org-agent-config";

async function requireAdmin(orgSlug: string) {
  const session = await getSession();
  if (session?.role !== "admin" || !isKnownOrganisation(orgSlug)) {
    throw new Error("No autorizado.");
  }
  return session;
}

export async function saveOrgIntegrationConfig(input: OrgAgentConfig) {
  const session = await requireAdmin(input.orgSlug);
  await Promise.all([
    safeEndpoint(input.preCallEndpoint),
    safeEndpoint(input.actionEndpoint),
    safeEndpoint(input.postCallEndpoint),
  ]);
  const current = await readOrgAgentConfig(input.orgSlug);
  const config: OrgAgentConfig = {
    ...current,
    ...input,
    orgSlug: input.orgSlug,
    frustrationThreshold: Math.min(100, Math.max(50, Number(input.frustrationThreshold))),
    metaPrompt: String(input.metaPrompt ?? "").trim().slice(0, 4000),
    extraInstructions: String(input.extraInstructions ?? "").trim().slice(0, 8000),
    firstMessage: String(input.firstMessage ?? "").trim().slice(0, 280) || current.firstMessage,
    firstMessageEn: String(input.firstMessageEn ?? "").trim().slice(0, 280) || current.firstMessageEn,
    language: String(input.language ?? current.language).trim().slice(0, 8) || "es",
    voiceId: String(input.voiceId ?? current.voiceId).trim() || current.voiceId,
    faq: input.faq
      .slice(0, 40)
      .map((item) => ({
        id: item.id || crypto.randomUUID(),
        question: item.question.trim().slice(0, 180),
        answer: item.answer.trim().slice(0, 1200),
      }))
      .filter((item) => item.question && item.answer),
    updatedAt: new Date().toISOString(),
    updatedBy: session.email,
  };
  await saveOrgAgentConfig(config);
  return { ok: true, message: "Configuración guardada.", config };
}

export async function checkOrgEndpoints(orgSlug: string) {
  await requireAdmin(orgSlug);
  const config = await readOrgAgentConfig(orgSlug);
  const targets = {
    preCall: config.preCallEndpoint,
    actions: config.actionEndpoint,
    postCall: config.postCallEndpoint,
  } as const;
  const health = { ...config.health };
  for (const [key, raw] of Object.entries(targets) as Array<
    [keyof typeof targets, string]
  >) {
    health[key] = await checkEndpointHealth(raw);
  }
  const next = { ...config, health };
  await saveOrgAgentConfig(next);
  return { ok: true, message: "Comprobación completada.", config: next };
}
