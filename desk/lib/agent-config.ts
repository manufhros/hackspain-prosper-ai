import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSetting, usesCloudflareStorage, writeSetting } from "./cloudflare-storage";

export type AgentConfig = {
  voiceId: string;
  voiceName: string;
  modelId: "eleven_flash_v2_5" | "eleven_multilingual_v2";
  voiceSpeed: number;
  backgroundEnabled: boolean;
  backgroundVolume: number;
  typingEnabled: boolean;
  typingBehavior: "auto" | "always";
  patientLookup: boolean;
  dynamicContext: boolean;
  actionTools: boolean;
  postCallWebhook: boolean;
  zeroRetention: boolean;
  euOnly: boolean;
  escalationFails: number;
  frustrationThreshold: number;
  routingMode: "shadow" | "enforce";
  faq: Array<{ id: string; question: string; answer: string }>;
};

export type AgentConfigVersion = {
  id: string;
  publishedAt: string;
  publishedBy: string;
  config: AgentConfig;
};

export type AgentConfigState = {
  draft: AgentConfig;
  active: AgentConfigVersion | null;
  versions: AgentConfigVersion[];
};

export const DEFAULT_FAQ: AgentConfig["faq"] = [
  {
    id: "faq-centros",
    question: "¿Qué centros tenéis?",
    answer: "La red dispone de Centro, Norte y Sur. El agente consulta la disponibilidad del centro que prefiera el paciente.",
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
    answer: "Se admiten Sanitas, Adeslas, DKV, ASISA, Mapfre, Caser, Cigna, AXA, Nueva Mutua y pacientes privados.",
  },
  {
    id: "faq-urgencias",
    question: "¿Qué ocurre si tengo una urgencia médica?",
    answer: "El agente no ofrece consejo médico. Ante señales de urgencia escala inmediatamente la llamada al equipo humano.",
  },
];

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  voiceId: "UOIqAnmS11Reiei1Ytkc",
  voiceName: "Carolina · española peninsular",
  modelId: "eleven_flash_v2_5",
  voiceSpeed: 0.96,
  backgroundEnabled: true,
  backgroundVolume: 0.07,
  typingEnabled: true,
  typingBehavior: "always",
  patientLookup: true,
  dynamicContext: true,
  actionTools: true,
  postCallWebhook: false,
  zeroRetention: true,
  euOnly: true,
  escalationFails: 3,
  frustrationThreshold: 75,
  routingMode: "shadow",
  faq: DEFAULT_FAQ.map((item) => ({ ...item })),
};

const DATA_FILE = path.resolve(process.cwd(), "..", "data", "agent-config.json");

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeAgentConfig(value: Partial<AgentConfig>): AgentConfig {
  return {
    ...DEFAULT_AGENT_CONFIG,
    ...value,
    voiceId: String(value.voiceId ?? DEFAULT_AGENT_CONFIG.voiceId).trim(),
    voiceName: String(value.voiceName ?? DEFAULT_AGENT_CONFIG.voiceName).trim(),
    voiceSpeed: asNumber(value.voiceSpeed, DEFAULT_AGENT_CONFIG.voiceSpeed),
    backgroundVolume: asNumber(
      value.backgroundVolume,
      DEFAULT_AGENT_CONFIG.backgroundVolume,
    ),
    escalationFails: asNumber(value.escalationFails, DEFAULT_AGENT_CONFIG.escalationFails),
    frustrationThreshold: asNumber(
      value.frustrationThreshold,
      DEFAULT_AGENT_CONFIG.frustrationThreshold,
    ),
    faq: Array.isArray(value.faq) && value.faq.length
      ? value.faq
          .slice(0, 40)
          .map((item) => ({
            id: String(item.id || crypto.randomUUID()),
            question: String(item.question ?? "").trim().slice(0, 180),
            answer: String(item.answer ?? "").trim().slice(0, 1200),
          }))
          .filter((item) => item.question && item.answer)
      : DEFAULT_FAQ.map((item) => ({ ...item })),
  };
}

export function validateAgentConfig(config: AgentConfig): string[] {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(config.voiceId)) errors.push("La voz no es válida.");
  if (config.voiceSpeed < 0.7 || config.voiceSpeed > 1.2) {
    errors.push("La velocidad debe estar entre 0,70 y 1,20.");
  }
  if (config.backgroundVolume < 0.01 || config.backgroundVolume > 0.2) {
    errors.push("El ambiente debe estar entre 0,01 y 0,20.");
  }
  if (!Number.isInteger(config.escalationFails) || config.escalationFails < 1 || config.escalationFails > 5) {
    errors.push("El umbral de escalado debe estar entre 1 y 5.");
  }
  if (config.frustrationThreshold < 50 || config.frustrationThreshold > 100) {
    errors.push("El umbral de frustración debe estar entre 50 y 100.");
  }
  if (!config.euOnly) errors.push("La región UE es obligatoria para este agente.");
  return errors;
}

export async function readAgentConfigState(): Promise<AgentConfigState> {
  const stored = usesCloudflareStorage()
    ? await readSetting<Partial<AgentConfigState>>("agent-config")
    : undefined;
  try {
    const parsed = stored === undefined
      ? JSON.parse(await readFile(DATA_FILE, "utf8")) as Partial<AgentConfigState>
      : stored ?? {};
    return {
      draft: normalizeAgentConfig(parsed.draft ?? {}),
      active: parsed.active
        ? { ...parsed.active, config: normalizeAgentConfig(parsed.active.config) }
        : null,
      versions: Array.isArray(parsed.versions)
        ? parsed.versions.map((version) => ({
            ...version,
            config: normalizeAgentConfig(version.config),
          }))
        : [],
    };
  } catch {
    return { draft: DEFAULT_AGENT_CONFIG, active: null, versions: [] };
  }
}

export async function writeAgentConfigState(state: AgentConfigState): Promise<void> {
  if (usesCloudflareStorage()) return writeSetting("agent-config", state);
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temp, DATA_FILE);
}

function parseEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match?.[1]) continue;
    result[match[1]] = (match[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return result;
}

async function rootSecrets() {
  if (usesCloudflareStorage()) {
    return { apiKey: process.env.ELEVENLABS_API_KEY, agentId: process.env.ELEVENLABS_AGENT_ID };
  }
  let file: Record<string, string> = {};
  try {
    file = parseEnv(await readFile(path.resolve(process.cwd(), "..", ".env"), "utf8"));
  } catch {
    file = {};
  }
  return {
    apiKey: process.env.ELEVENLABS_API_KEY ?? file.ELEVENLABS_API_KEY,
    agentId: process.env.ELEVENLABS_AGENT_ID ?? file.ELEVENLABS_AGENT_ID,
  };
}

async function patchToolSounds(
  apiKey: string,
  enabled: boolean,
  behavior: AgentConfig["typingBehavior"],
) {
  const headers = { "xi-api-key": apiKey, "content-type": "application/json" };
  const response = await fetch("https://api.elevenlabs.io/v1/convai/tools", { headers });
  if (!response.ok) throw new Error(`No se pudieron leer las herramientas (${response.status}).`);
  const body = (await response.json()) as {
    tools?: Array<{ id?: string; tool_id?: string; tool_config?: Record<string, unknown> }>;
  };
  const names = new Set(["search_directory", "search_availability", "list_appointments"]);
  for (const tool of body.tools ?? []) {
    const name = typeof tool.tool_config?.name === "string" ? tool.tool_config.name : "";
    const id = tool.id ?? tool.tool_id;
    if (!id || !names.has(name)) continue;
    const toolConfig = { ...tool.tool_config };
    if (enabled) {
      toolConfig.tool_call_sound = "typing";
      toolConfig.tool_call_sound_behavior = behavior;
    } else {
      delete toolConfig.tool_call_sound;
      delete toolConfig.tool_call_sound_behavior;
    }
    const update = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ tool_config: toolConfig }),
    });
    if (!update.ok) throw new Error(`No se pudo actualizar ${name} (${update.status}).`);
  }
}

export async function publishAgentConfig(config: AgentConfig): Promise<void> {
  const { apiKey, agentId } = await rootSecrets();
  if (!apiKey || !agentId) throw new Error("Faltan credenciales de ElevenLabs en el servidor.");
  const headers = { "xi-api-key": apiKey, "content-type": "application/json" };
  const endpoint = `https://api.elevenlabs.io/v1/convai/agents/${agentId}`;
  const before = await fetch(endpoint, { headers });
  if (!before.ok) throw new Error(`No se pudo leer el agente (${before.status}).`);
  const previous = (await before.json()) as { conversation_config?: unknown };
  const patch = {
    conversation_config: {
      tts: {
        voice_id: config.voiceId,
        model_id: config.modelId,
        speed: config.voiceSpeed,
        agent_output_audio_format: "ulaw_8000",
      },
      conversation: {
        background_sound: config.backgroundEnabled
          ? {
              source_type: "preset",
              source_id: "office1",
              volume: config.backgroundVolume,
              crossfade_loop: true,
            }
          : null,
      },
    },
  };
  const updated = await fetch(endpoint, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  if (!updated.ok) throw new Error(`ElevenLabs rechazó la configuración (${updated.status}).`);
  try {
    await patchToolSounds(apiKey, config.typingEnabled, config.typingBehavior);
    const check = await fetch(endpoint, { headers });
    const remote = (await check.json()) as {
      conversation_config?: { tts?: { voice_id?: string } };
    };
    if (!check.ok || remote.conversation_config?.tts?.voice_id !== config.voiceId) {
      throw new Error("ElevenLabs no confirmó la voz publicada.");
    }
  } catch (error) {
    if (previous.conversation_config) {
      await fetch(endpoint, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ conversation_config: previous.conversation_config }),
      });
    }
    throw error;
  }
}
