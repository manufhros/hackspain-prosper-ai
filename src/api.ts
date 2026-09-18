import { type Endpoint, type ObjectValue, resolveSchema } from "./data";
import { validate, validDate } from "./validation";

export function baseUrl(input: string): string {
  const url = new URL(input);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Use HTTPS (HTTP is allowed only for localhost).");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Enter only the API origin, without credentials, path, query or fragment.");
  return url.origin;
}
export const keyIdentity = (origin: string) => ({ service: "dev.hackspain.el-turno-workbench", name: baseUrl(origin) });
export interface PreparedRequest { method: string; path: string; body?: ObjectValue }
export function prepareRequest(endpoint: Endpoint, fields: ObjectValue): PreparedRequest {
  if (endpoint.requestBody) {
    const errors = validate(fields, endpoint.requestBody.content["application/json"].schema);
    if (errors.length) throw new Error(errors.join("\n"));
    return { method: endpoint.method, path: endpoint.path, body: fields };
  }
  let path = endpoint.path;
  const query = new URLSearchParams();
  const errors: string[] = [];
  for (const key of Object.keys(fields)) if (!endpoint.parameters?.some(p => p.name === key)) errors.push(`${key}: unknown parameter`);
  for (const parameter of endpoint.parameters ?? []) {
    const value = fields[parameter.name];
    if (value === undefined || value === "") {
      if (parameter.required) errors.push(`${parameter.name}: required`);
      continue;
    }
    errors.push(...validate(value, parameter.schema, parameter.name));
    if (parameter.in === "path") path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    else for (const entry of Array.isArray(value) ? value : [value]) query.append(parameter.name, String(entry));
  }
  if (endpoint.path.endsWith("/directory") && !query.size) errors.push("directory: enter at least one identifier");
  if (endpoint.path.endsWith("/availability")) {
    if (!fields.provider_id && !fields.specialty_id) errors.push("availability: provider_id or specialty_id required");
    const from = String(fields.date_from), to = String(fields.date_to);
    if (validDate(from) && validDate(to)) {
      const span = (Date.parse(to) - Date.parse(from)) / 86400000;
      if (span < 0 || span > 13) errors.push("availability: use an inclusive window of 1–14 days");
      if (from < "2026-09-07" || to > "2026-10-16") errors.push("availability: archived calendar is 2026-09-07 through 2026-10-16");
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return { method: endpoint.method, path: path + (query.size ? `?${query}` : "") };
}
export function inputSchema(input: Parameters<typeof resolveSchema>[0]) {
  const s = resolveSchema(input);
  return resolveSchema(s.anyOf?.find(option => option.type !== "null") ?? s);
}
export function parseField(value: string, schema: Parameters<typeof resolveSchema>[0]): unknown {
  const s = inputSchema(schema);
  if (s.type === "integer" || s.type === "number") return Number(value);
  if (s.type === "array") return value.split(",").map(v => v.trim()).filter(Boolean);
  return value;
}
export const statusMeaning = (status: number): string => ({
  200: "Received successfully. For submissions this is receipt, not a passing verdict.",
  403: "Missing, invalid or revoked team key.", 404: "Unknown resource/call, or belongs to another team.",
  409: "Identical action already accepted. Do not append another copy.",
  410: "Call closed more than 30 seconds ago; submission window expired.",
  422: "Invalid input; nothing recorded.", 429: "Rate limited; respect the platform cooldown.",
}[status] ?? `HTTP ${status}; inspect the response.`);
export interface ApiResponse { status: number; elapsed_ms: number; meaning: string; data: unknown }
export type HttpTransport = (url: string | URL, init?: RequestInit) => Promise<Response>;
export class PlatformClient {
  readonly origin: string;
  constructor(origin: string, private readonly key: string | null, private readonly send: HttpTransport = fetch) {
    this.origin = baseUrl(origin);
  }
  async request(request: PreparedRequest, signal?: AbortSignal): Promise<ApiResponse> {
    const target = new URL(request.path, this.origin);
    if (target.origin !== this.origin || !target.pathname.startsWith("/api/v1/")) throw new Error("Request outside configured API origin.");
    if (!this.key && target.pathname !== "/api/v1/health") throw new Error("Configure the team API key in Setup first.");
    const started = performance.now();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.key) headers["X-Api-Key"] = this.key;
    if (request.body) headers["Content-Type"] = "application/json";
    try {
      const response = await this.send(target, {
        method: request.method, headers, body: request.body ? JSON.stringify(request.body) : undefined,
        redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      });
      const raw = await response.text();
      const safe = this.key ? raw.replaceAll(this.key, "[REDACTED]") : raw;
      let data: unknown = safe;
      try { data = JSON.parse(safe); } catch { /* Keep non-JSON error response readable. */ }
      return { status: response.status, elapsed_ms: Math.round(performance.now() - started), meaning: statusMeaning(response.status), data };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      throw new Error(this.key ? message.replaceAll(this.key, "[REDACTED]") : message);
    }
  }
}
