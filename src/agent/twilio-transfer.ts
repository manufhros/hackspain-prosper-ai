import type { AuditAction } from "./audit.ts";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export type TransferResult =
  | { configured: false; error?: string }
  | {
      configured: true;
      transferred: boolean;
      originated?: boolean;
      status?: number;
      callSid?: string;
      error?: string;
    };

function twilioAuth() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (accountSid && authToken) return { user: accountSid, pass: authToken };
  const apiKey = process.env.TWILIO_API_KEY_SID?.trim();
  const apiSecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  if (apiKey && apiSecret) return { user: apiKey, pass: apiSecret };
  return null;
}

function credentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const auth = twilioAuth();
  const humanNumber = process.env.TWILIO_HUMAN_NUMBER?.trim();
  const callerId = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!accountSid || !auth || !humanNumber || !callerId) {
    return null;
  }
  return { accountSid, auth, humanNumber, callerId };
}

function spokenHandoff(summary?: string) {
  const extra = summary?.trim().replace(/\s+/g, " ").slice(0, 160);
  return extra
    ? `Le transfiere recepción. ${extra}`
    : "Le transfiere recepción. El paciente ha pedido hablar con una persona.";
}

export function handoffTwiml(summary?: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-ES">${xml(spokenHandoff(summary))}</Say><Pause length="3"/></Response>`;
}

/** Trial accounts reject inline `Twiml`. Use a short HTTPS message URL Twilio can fetch. */
export function handoffVoiceUrl(summary?: string) {
  const configured = process.env.TWILIO_HANDOFF_URL?.trim();
  if (configured) return configured;
  return `https://twimlets.com/message?Message=${encodeURIComponent(spokenHandoff(summary))}`;
}

export function dialHumanUrl(humanNumber: string) {
  const configured = process.env.TWILIO_DIAL_URL?.trim();
  if (configured) return configured;
  return `https://twimlets.com/forward?PhoneNumber=${encodeURIComponent(humanNumber)}`;
}

async function twilioPost(path: string, body: URLSearchParams, audit?: AuditAction) {
  const creds = credentials();
  if (!creds) return null;
  const requestId = crypto.randomUUID();
  await audit?.("handoff.requested", { requestId, provider: "twilio", path, body: Object.fromEntries(body) });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}${path}`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${creds.auth.user}:${creds.auth.pass}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(8_000),
    },
  ).catch(async (error: unknown) => {
    await audit?.("handoff.failed", { requestId, provider: "twilio", errorType: error instanceof Error ? error.name : "UnknownError" });
    throw error;
  });
  const raw = await response.text();
  let payload: { sid?: string; message?: string } = {};
  try {
    payload = JSON.parse(raw) as { sid?: string; message?: string };
  } catch {
    payload = { message: raw.slice(0, 240) };
  }
  if (!response.ok) {
    console.error("twilio transfer failed", response.status, payload.message ?? raw.slice(0, 240));
  }
  await audit?.("handoff.completed", { requestId, provider: "twilio", status: response.status, callSid: payload.sid ?? null });
  return {
    ok: response.ok,
    status: response.status,
    callSid: payload.sid,
    error: response.ok ? undefined : payload.message ?? raw.slice(0, 240),
  };
}

export async function originateHandoffCall(summary?: string, audit?: AuditAction): Promise<TransferResult> {
  const creds = credentials();
  if (!creds) {
    await audit?.("handoff.skipped", { reason: "missing_credentials" });
    return { configured: false, error: "Faltan TWILIO_ACCOUNT_SID, números o token." };
  }
  const posted = await twilioPost(
    "/Calls.json",
    new URLSearchParams({
      To: creds.humanNumber,
      From: creds.callerId,
      Url: handoffVoiceUrl(summary),
    }),
    audit,
  );
  if (!posted) return { configured: false, error: "No se pudo contactar con Twilio." };
  return {
    configured: true,
    transferred: posted.ok,
    originated: true,
    status: posted.status,
    ...(posted.callSid ? { callSid: posted.callSid } : {}),
    ...(posted.error ? { error: posted.error } : {}),
  };
}

export async function transferTwilioCall(
  callSid?: string,
  summary?: string,
  audit?: AuditAction,
): Promise<TransferResult> {
  const creds = credentials();
  if (!creds) {
    await audit?.("handoff.skipped", { reason: "missing_credentials" });
    return { configured: false, error: "Faltan TWILIO_ACCOUNT_SID, números o token." };
  }
  if (callSid && !callSid.includes("-")) {
    const updated = await twilioPost(
      `/Calls/${encodeURIComponent(callSid)}.json`,
      new URLSearchParams({ Url: dialHumanUrl(creds.humanNumber) }),
      audit,
    );
    if (updated?.ok) {
      return { configured: true, transferred: true, status: updated.status, callSid };
    }
  }
  return originateHandoffCall(summary, audit);
}
