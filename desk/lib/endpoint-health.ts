import { isIP } from "node:net";
import type { EndpointHealth } from "./org-agent-config";

export const PROSPER_API_BASE = "https://hackspain.getprosperapp.com/api/v1";

function privateAddress(address: string) {
  if (!isIP(address)) return true;
  if (isIP(address) === 6) {
    // Accept only global unicast IPv6; this also rejects IPv4-mapped addresses.
    const first = Number.parseInt(address.split(":")[0] || "0", 16);
    return first < 0x2000 || first > 0x3fff;
  }
  const [a = 0, b = 0] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  // Use fetch directly: Node DNS prechecks fail in the deployed Next/Workers
  // runtime and previously turned every Prosper endpoint into a false outage.
  const answers = await Promise.all([1, 28].map(async (type) => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", String(type));
    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`No se pudo comprobar DNS (HTTP ${response.status}).`);
    const data = await response.json() as {
      Status?: number;
      Answer?: Array<{ type: number; data: string }>;
    };
    if (data.Status !== 0) throw new Error("No se pudo resolver el dominio del endpoint.");
    return (data.Answer ?? []).filter((answer) => answer.type === type).map((answer) => answer.data);
  }));
  return answers.flat();
}

export async function safeEndpoint(raw: string): Promise<URL | null> {
  if (!raw.trim()) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Los endpoints deben usar HTTPS y no incluir credenciales.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "hackspain.getprosperapp.com") return url;
  const addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
  if (!addresses.length) throw new Error("No se pudo resolver el dominio del endpoint.");
  if (addresses.some(privateAddress)) {
    throw new Error("El endpoint resuelve a una red privada o no permitida.");
  }
  return url;
}

export async function checkEndpointHealth(raw: string): Promise<EndpointHealth> {
  const started = Date.now();
  try {
    const url = await safeEndpoint(raw);
    if (!url) return { status: "unknown", checkedAt: new Date().toISOString(), latencyMs: null, statusCode: null, message: "Sin configurar" };
    const isProsper = url.origin === new URL(PROSPER_API_BASE).origin;
    const response = await fetch(isProsper ? `${PROSPER_API_BASE}/health` : url, {
      method: "GET",
      headers: { "x-hash-health-check": "1" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    await response.body?.cancel();
    return {
      status: response.ok ? "healthy" : response.status < 500 ? "degraded" : "down",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      statusCode: response.status,
      message: response.ok ? "Operativo" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: "down",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      statusCode: null,
      message: error instanceof Error ? error.message.slice(0, 160) : "No disponible",
    };
  }
}
