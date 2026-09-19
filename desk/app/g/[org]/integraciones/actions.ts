"use server";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getSession } from "@/lib/session";
import {
  PROSPER_API_BASE,
  readOrgAgentConfig,
  saveOrgAgentConfig,
  type EndpointHealth,
  type OrgAgentConfig,
} from "@/lib/org-agent-config";

async function requireDeveloper(orgSlug: string) {
  const session = await getSession();
  if (session?.kind !== "org" || session.orgSlug !== orgSlug || session.role !== "dev") {
    throw new Error("No autorizado.");
  }
  return session;
}

function privateAddress(address: string) {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80")) return true;
  if (!isIP(address)) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

async function safeEndpoint(raw: string): Promise<URL | null> {
  if (!raw.trim()) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Los endpoints deben usar HTTPS y no incluir credenciales.");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) {
    throw new Error("El endpoint resuelve a una red privada o no permitida.");
  }
  return url;
}

export async function saveOrgIntegrationConfig(input: OrgAgentConfig) {
  const session = await requireDeveloper(input.orgSlug);
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
  await requireDeveloper(orgSlug);
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
    const started = Date.now();
    let result: EndpointHealth;
    try {
      const url = await safeEndpoint(raw);
      if (!url) {
        result = { status: "unknown", checkedAt: new Date().toISOString(), latencyMs: null, statusCode: null, message: "Sin configurar" };
      } else {
        const healthUrl =
          url.hostname === "hackspain.getprosperapp.com"
            ? new URL(`${PROSPER_API_BASE}/health`)
            : url;
        const response = await fetch(healthUrl, {
          method: "GET",
          headers: { "x-hash-health-check": "1" },
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        });
        result = {
          status: response.ok ? "healthy" : response.status < 500 ? "degraded" : "down",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          statusCode: response.status,
          message: response.ok ? "Operativo" : `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      result = {
        status: "down",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        statusCode: null,
        message: error instanceof Error ? error.message.slice(0, 160) : "No disponible",
      };
    }
    health[key] = result;
  }
  const next = { ...config, health };
  await saveOrgAgentConfig(next);
  return { ok: true, message: "Comprobación completada.", config: next };
}
