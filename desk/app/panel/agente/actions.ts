"use server";

import { checkEndpointHealth, PROSPER_API_BASE, safeEndpoint } from "@/lib/endpoint-health";
import { CLINIC } from "@/lib/clinic";
import { isKnownOrganisation } from "@/lib/orgs";
import { hooksFromRoutes, PROSPER_ENDPOINTS, routesFromConfig } from "@/lib/prosper-endpoints";
import { getSession } from "@/lib/session";
import {
  readOrgAgentConfig,
  saveOrgAgentConfig,
  type OrgAgentConfig,
} from "@/lib/org-agent-config";

async function requireConfigEditor(orgSlug: string) {
  const session = await getSession();
  if (!session || !isKnownOrganisation(orgSlug)) throw new Error("No autorizado.");
  if (session.role === "admin") return session;
  if (session.role === "clinic" && orgSlug === CLINIC.slug) return session;
  throw new Error("No autorizado.");
}

export async function saveOrgIntegrationConfig(input: OrgAgentConfig) {
  const session = await requireConfigEditor(input.orgSlug);
  const current = await readOrgAgentConfig(input.orgSlug);
  const clinicLocked = session.role === "clinic";
  const routes = routesFromConfig(input);
  await Promise.all(PROSPER_ENDPOINTS.map((item) => safeEndpoint(routes[item.path] ?? "")));
  const hooks = hooksFromRoutes(routes);
  const config: OrgAgentConfig = {
    ...current,
    ...input,
    orgSlug: input.orgSlug,
    ...hooks,
    routes,
    frustrationThreshold: Math.min(100, Math.max(50, Number(input.frustrationThreshold) || current.frustrationThreshold)),
    escalationFails: Math.min(5, Math.max(1, Math.round(Number(input.escalationFails) || current.escalationFails))),
    metaPrompt: clinicLocked
      ? current.metaPrompt
      : String(input.metaPrompt ?? "").trim().slice(0, 4000),
    extraInstructions: String(input.extraInstructions ?? "").trim().slice(0, 8000),
    firstMessage: String(input.firstMessage ?? "").trim().slice(0, 280) || current.firstMessage,
    firstMessageEn: String(input.firstMessageEn ?? "").trim().slice(0, 280) || current.firstMessageEn,
    language: clinicLocked
      ? current.language
      : String(input.language ?? current.language).trim().slice(0, 8) || "es",
    voiceId: clinicLocked
      ? current.voiceId
      : String(input.voiceId ?? current.voiceId).trim() || current.voiceId,
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
  await requireConfigEditor(orgSlug);
  const config = await readOrgAgentConfig(orgSlug);
  const prosperOrigin = new URL(PROSPER_API_BASE).origin;
  const groups = new Map<string, string[]>();
  for (const item of PROSPER_ENDPOINTS) {
    const raw = config.routes[item.path] ?? item.url;
    let key = "invalid";
    try {
      const origin = new URL(raw).origin;
      key = origin === prosperOrigin ? prosperOrigin : raw;
    } catch {
      key = "invalid";
    }
    const paths = groups.get(key) ?? [];
    paths.push(item.path);
    groups.set(key, paths);
  }
  const unknown: OrgAgentConfig["health"]["preCall"] = {
    status: "unknown",
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    statusCode: null,
    message: "URL no válida",
  };
  const routeHealth: OrgAgentConfig["routeHealth"] = {};
  await Promise.all([...groups.entries()].map(async ([key, paths]) => {
    const probed = key === "invalid"
      ? unknown
      : await checkEndpointHealth(key === prosperOrigin ? `${PROSPER_API_BASE}/health` : key);
    for (const path of paths) routeHealth[path] = probed;
  }));
  const next = {
    ...config,
    routeHealth,
    health: {
      preCall: routeHealth["/api/v1/directory"] ?? unknown,
      actions: routeHealth["/api/v1/availability"] ?? unknown,
      postCall: routeHealth["/api/v1/submissions"] ?? unknown,
    },
  };
  await saveOrgAgentConfig(next);
  return { ok: true, message: "Comprobación completada.", config: next };
}
