import { publicHttpOrigin, twilioRequest } from "../agent/twilio-transfer.ts";
export function demoNumber() {
  const number = process.env.TWILIO_HUMAN_NUMBER?.trim();
  if (!number || !/^\+[1-9]\d{7,14}$/.test(number)) throw new Error("Configura TWILIO_HUMAN_NUMBER en formato internacional (+...).");
  return number;
}
export class TwilioRequestError extends Error {
  constructor(readonly status: number, readonly code?: number) {
    super(`Twilio HTTP ${status}${code ? ` · código ${code}` : ""}`);
  }
  get rejected() { return this.status >= 400 && this.status < 500 && this.status !== 408; }
}
export async function operationsOrigin() { return await publicHttpOrigin() ?? ""; }
async function request(path: string, body?: URLSearchParams): Promise<{ sid?: string | undefined; status?: string | undefined; type?: string | undefined }> {
  const response = await twilioRequest(path, body);
  if (!response) throw new Error("Falta configurar Twilio.");
  if (!response.ok) throw new TwilioRequestError(response.status, response.code);
  return { sid: response.callSid, status: response.callStatus, type: response.accountType };
}
export async function checkPhone() {
  demoNumber();
  if (!process.env.TWILIO_PHONE_NUMBER?.trim()) throw new Error("Falta TWILIO_PHONE_NUMBER.");
  // Check credentials, not account tier: the actual Streams response is authoritative.
  await request(".json");
}
export async function dialPatient(url: string) {
  return request("/Calls.json", new URLSearchParams({
    To: demoNumber(), From: process.env.TWILIO_PHONE_NUMBER!.trim(), Url: url,
  }));
}
export async function stopPhone(sid: string) {
  if (!/^CA[a-f0-9]{32}$/i.test(sid)) throw new Error("Call SID inválido.");
  return request(`/Calls/${sid}.json`, new URLSearchParams({ Status: "completed" }));
}
export async function phoneStatus(sid: string) { return request(`/Calls/${sid}.json`); }
