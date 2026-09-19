export const DEMO_NUMBER = "+34601408225";
export class TwilioRequestError extends Error {
  constructor(readonly status: number, readonly code?: number) {
    super(`Twilio HTTP ${status}${code ? ` · código ${code}` : ""}`);
  }
  get rejected() { return this.status >= 400 && this.status < 500 && this.status !== 408; }
}
export function operationsOrigin() {
  const value = process.env.VOICE_AGENT_PUBLIC_URL?.trim();
  if (!value) return "";
  const url = new URL(value.replace(/^wss:/, "https:").replace(/^ws:/, "http:"));
  return url.origin;
}
function credentials() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const user = process.env.TWILIO_AUTH_TOKEN ? sid : process.env.TWILIO_API_KEY_SID;
  const pass = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_API_KEY_SECRET;
  if (!sid || !user || !pass || !process.env.TWILIO_PHONE_NUMBER) throw new Error("Falta configurar Twilio.");
  return { sid, authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}
async function request(path: string, body?: URLSearchParams) {
  const { sid, authorization } = credentials();
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: body ? "POST" : "GET", headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
    ...(body ? { body } : {}), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { code?: number };
    throw new TwilioRequestError(response.status, detail.code);
  }
  return response.json() as Promise<{ sid?: string; status?: string; type?: string }>;
}
export async function checkPhone() {
  // Check credentials, not account tier: the actual Streams response is authoritative.
  await request(".json");
}
export async function dialPatient(url: string) {
  return request("/Calls.json", new URLSearchParams({
    To: DEMO_NUMBER, From: process.env.TWILIO_PHONE_NUMBER!, Url: url, TimeLimit: "300", Timeout: "30",
  }));
}
export async function stopPhone(sid: string) {
  if (!/^CA[a-f0-9]{32}$/i.test(sid)) throw new Error("Call SID inválido.");
  return request(`/Calls/${sid}.json`, new URLSearchParams({ Status: "completed" }));
}
export async function phoneStatus(sid: string) { return request(`/Calls/${sid}.json`); }
