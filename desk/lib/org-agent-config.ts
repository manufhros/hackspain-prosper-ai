import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSetting, usesCloudflareStorage, writeSetting } from "./cloudflare-storage";

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
  health: Record<"preCall" | "actions" | "postCall", EndpointHealth>;
  updatedAt: string | null;
  updatedBy: string | null;
};

const FILE = path.resolve(process.cwd(), "..", "data", "org-agent-config.json");
export const PROSPER_API_BASE = "https://hackspain.getprosperapp.com/api/v1";
const EMPTY_HEALTH: EndpointHealth = {
  status: "unknown",
  checkedAt: null,
  latencyMs: null,
  statusCode: null,
  message: null,
};

const DEFAULT_FAQ = [
  {
    id: "faq-centros",
    question: "¿Qué centros tenéis?",
    answer: "La red de demostración dispone de Centro, Norte y Sur. El agente consulta la disponibilidad del centro que prefiera el paciente.",
  },
  {
    id: "faq-sabado",
    question: "¿Qué centro abre los sábados?",
    answer: "Centro abre los sábados. Norte y Sur permanecen cerrados. Ningún centro abre los domingos.",
  },
  {
    id: "faq-gestiones",
    question: "¿Qué gestiones puedo hacer por teléfono?",
    answer: "Puede consultar disponibilidad, reservar, cambiar o cancelar una cita y registrarse como paciente nuevo.",
  },
  {
    id: "faq-seguros",
    question: "¿Con qué aseguradoras trabajáis?",
    answer: "Se admiten Sanitas, Adeslas, DKV, ASISA, Mapfre, Caser, Cigna, AXA, Nueva Mutua y pacientes privados. La cobertura concreta se comprueba para cada especialidad y profesional.",
  },
  {
    id: "faq-documentacion",
    question: "¿Qué datos necesito para identificarme?",
    answer: "El agente puede localizar la ficha por teléfono. Si hay varias coincidencias, solicitará DNI o NIE o fecha de nacimiento para verificar la identidad.",
  },
  {
    id: "faq-paciente-nuevo",
    question: "¿Puedo darme de alta como paciente nuevo?",
    answer: "Sí. Se solicitarán nombre y apellidos, DNI o NIE, fecha de nacimiento, teléfono, correo electrónico y aseguradora.",
  },
  {
    id: "faq-urgencias",
    question: "¿Qué ocurre si tengo una urgencia médica?",
    answer: "El agente no ofrece consejo médico. Ante señales de urgencia escala inmediatamente la llamada al equipo humano.",
  },
] as const;

export function defaultOrgAgentConfig(orgSlug: string): OrgAgentConfig {
  return {
    orgSlug,
    preCallEndpoint: `${PROSPER_API_BASE}/directory`,
    actionEndpoint: `${PROSPER_API_BASE}/availability`,
    postCallEndpoint: `${PROSPER_API_BASE}/submissions`,
    frustrationThreshold: 75,
    faq: DEFAULT_FAQ.map((item) => ({ ...item })),
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
  };
}

export async function saveOrgAgentConfig(config: OrgAgentConfig): Promise<void> {
  if (usesCloudflareStorage()) return writeSetting(`org-agent-config:${config.orgSlug}`, config);
  const all = await readAll();
  all[config.orgSlug] = config;
  await writeAll(all);
}
