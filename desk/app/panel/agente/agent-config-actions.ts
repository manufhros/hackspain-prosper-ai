"use server";

import {
  normalizeAgentConfig,
  publishAgentConfig,
  readAgentConfigState,
  validateAgentConfig,
  writeAgentConfigState,
  type AgentConfig,
  type AgentConfigState,
} from "@/lib/agent-config";
import { getSession } from "@/lib/session";

export type AgentConfigResult = {
  ok: boolean;
  message: string;
  state?: AgentConfigState;
};

async function requireAdmin() {
  const session = await getSession();
  if (session?.role !== "admin") throw new Error("No autorizado.");
  return session;
}

export async function saveAgentDraft(input: AgentConfig): Promise<AgentConfigResult> {
  await requireAdmin();
  const config = normalizeAgentConfig(input);
  const errors = validateAgentConfig(config);
  if (errors.length) return { ok: false, message: errors.join(" ") };
  const state = await readAgentConfigState();
  const next = { ...state, draft: config };
  await writeAgentConfigState(next);
  return { ok: true, message: "Borrador guardado.", state: next };
}

export async function publishAgentDraft(input: AgentConfig): Promise<AgentConfigResult> {
  const session = await requireAdmin();
  const config = normalizeAgentConfig(input);
  const errors = validateAgentConfig(config);
  if (errors.length) return { ok: false, message: errors.join(" ") };
  const state = await readAgentConfigState();
  try {
    await publishAgentConfig(config);
    const version = {
      id: crypto.randomUUID(),
      publishedAt: new Date().toISOString(),
      publishedBy: session.email,
      config,
    };
    const next = {
      draft: config,
      active: version,
      versions: [version, ...state.versions].slice(0, 20),
    };
    await writeAgentConfigState(next);
    return { ok: true, message: "Configuración publicada y verificada.", state: next };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo publicar.",
    };
  }
}

export async function rollbackAgentConfig(versionId: string): Promise<AgentConfigResult> {
  await requireAdmin();
  const state = await readAgentConfigState();
  const target = state.versions.find((version) => version.id === versionId);
  if (!target) return { ok: false, message: "La versión ya no está disponible." };
  return publishAgentDraft(target.config);
}
