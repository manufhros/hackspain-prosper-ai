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

function spokenHandoff() {
  return "Le transfiere recepción. Un compañero se pone al teléfono.";
}

export function handoffTwiml(_summary?: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-ES">${xml(spokenHandoff())}</Say><Pause length="3"/></Response>`;
}

export function liveStreamTwiml(wsUrl: string, joinCallId: string, orgSlug = "arenal") {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-ES">Le pongo con recepción.</Say><Connect><Stream url="${xml(wsUrl)}"><Parameter name="join" value="${xml(joinCallId)}"/><Parameter name="org_slug" value="${xml(orgSlug)}"/></Stream></Connect></Response>`;
}

/** Trial accounts reject inline `Twiml`. Use a short HTTPS message URL Twilio can fetch. */
export function handoffVoiceUrl(_summary?: string) {
  const configured = process.env.TWILIO_HANDOFF_URL?.trim();
  if (configured) return configured;
  return `https://twimlets.com/message?Message=${encodeURIComponent(spokenHandoff())}`;
}

export function dialHumanUrl(humanNumber: string) {
  const configured = process.env.TWILIO_DIAL_URL?.trim();
  if (configured) return configured;
  return `https://twimlets.com/forward?PhoneNumber=${encodeURIComponent(humanNumber)}`;
}

export async function publicHttpOrigin(): Promise<string | null> {
  const configured = process.env.VOICE_AGENT_PUBLIC_URL?.trim() || process.env.TWILIO_HANDOFF_URL?.trim();
  if (configured) {
    return configured
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/ws\/?$/, "")
      .replace(/\/twiml\/.*$/, "");
  }
  try {
    const response = await fetch("http://127.0.0.1:4040/api/tunnels", {
      signal: AbortSignal.timeout(1500),
    });
    const data = (await response.json()) as { tunnels?: Array<{ public_url?: string }> };
    return data.tunnels?.find((tunnel) => tunnel.public_url?.startsWith("https://"))?.public_url ?? null;
  } catch {
    return null;
  }
}

function wsUrlFromOrigin(origin: string) {
  return `${origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/ws`;
}

async function twilioPost(path: string, body: URLSearchParams) {
  const creds = credentials();
  if (!creds) return null;
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
  );
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
  return {
    ok: response.ok,
    status: response.status,
    callSid: payload.sid,
    error: response.ok ? undefined : payload.message ?? raw.slice(0, 240),
  };
}

export async function originateHandoffCall(join?: {
  callId: string;
  orgSlug?: string;
}): Promise<TransferResult> {
  const creds = credentials();
  if (!creds) {
    return { configured: false, error: "Faltan TWILIO_ACCOUNT_SID, números o token." };
  }
  let url = handoffVoiceUrl();
  if (join) {
    const origin = await publicHttpOrigin();
    if (!origin) {
      return {
        configured: true,
        transferred: false,
        originated: false,
        error: "No hay URL pública (ngrok) para unir el móvil a la llamada.",
      };
    }
    url = `${origin}/twiml/live?join=${encodeURIComponent(join.callId)}&org=${encodeURIComponent(join.orgSlug ?? "arenal")}`;
  }
  const posted = await twilioPost(
    "/Calls.json",
    new URLSearchParams({
      To: creds.humanNumber,
      From: creds.callerId,
      Url: url,
    }),
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
  join?: { callId: string; orgSlug?: string },
): Promise<TransferResult> {
  const creds = credentials();
  if (!creds) {
    return { configured: false, error: "Faltan TWILIO_ACCOUNT_SID, números o token." };
  }
  if (join) return originateHandoffCall(join);
  if (callSid && !callSid.includes("-")) {
    const updated = await twilioPost(
      `/Calls/${encodeURIComponent(callSid)}.json`,
      new URLSearchParams({ Url: dialHumanUrl(creds.humanNumber) }),
    );
    if (updated?.ok) {
      return { configured: true, transferred: true, status: updated.status, callSid };
    }
  }
  return originateHandoffCall();
}

export { wsUrlFromOrigin };
