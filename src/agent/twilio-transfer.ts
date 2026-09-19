import type { AuditAction } from "./audit.ts";
import { callLogError } from "./call-log.ts";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function sayEs(text: string) {
  return `<Say language="es-ES" voice="Polly.Sergio-Neural">${xml(text)}</Say>`;
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
  return "Le transfiere recepción. Una compañera se pone al teléfono.";
}

export function handoffTwiml(_summary?: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${sayEs(spokenHandoff())}<Pause length="3"/></Response>`;
}

export const PATIENT_SPEECH =
  "Hola, buenos días. Llamaba para pedir la primera cita de medicina general, lo antes posible. ¿Tienen hueco por la mañana?";

export const PATIENT_REPLY = "Sí, esa hora me viene muy bien. Gracias.";
export const PATIENT_WAIT_REPLY = "Vale, muchas gracias, espero a tu compañera.";

export function patientReplyFor(helperText: string): string | undefined {
  const norm = normalizeSpeech(helperText);
  if (!norm || /^(um+|uh+|hmm+|mhm+|mm+)$/.test(norm)) return undefined;
  if (norm.includes("companer") || norm.includes("paso con")) return PATIENT_WAIT_REPLY;
  if (
    norm.includes("cita") ||
    norm.includes("viene bien") ||
    norm.includes("hora") ||
    norm.includes("nueve") ||
    /\b9\b/.test(norm)
  ) {
    return PATIENT_REPLY;
  }
  return "Vale, gracias.";
}

function normalizeSpeech(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[¿?¡!.,;:–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The phone plays the patient; the helper only confirms the booking. Never keep both in one turn. */
export function splitHandoffTranscript(text: string): { patient?: string; helper?: string } {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return {};
  const norm = normalizeSpeech(raw);
  const patientish =
    (norm.includes("medicina general") || norm.includes("primera cita")) &&
    (norm.includes("hueco") || norm.includes("por la manana") || norm.includes("llamaba para pedir"));
  if (!patientish) return { helper: raw };
  const cut = raw.match(/por la ma[ñn]ana[^?]{0,16}\??/i);
  if (cut?.index != null) {
    const helper = raw.slice(cut.index + cut[0].length).replace(/^[\s.,;:¿¡-]+/, "").trim();
    return { patient: PATIENT_SPEECH, ...(helper ? { helper } : {}) };
  }
  return { patient: PATIENT_SPEECH };
}

export function patientReplyTwiml(text = PATIENT_REPLY) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${sayEs(text)}<Pause length="600"/></Response>`;
}

/** Dynamic agent speech, while the separate inbound REST stream keeps listening. */
export function agentReplyTwiml(text: string, nextUrl: string, callId: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><!-- ${xml(callId)} -->${text ? sayEs(text) : '<Pause length="1"/>'}<Redirect method="POST">${xml(nextUrl)}</Redirect></Response>`;
}

export async function updateCallUrl(callSid: string, url: string) {
  return twilioPost(
    `/Calls/${encodeURIComponent(callSid)}.json`,
    new URLSearchParams({ Url: url }),
  );
}

export function liveStreamTwiml(
  wsUrl: string,
  joinCallId: string,
  orgSlug = "arenal",
  statusCallback?: string,
  streamPhoneAudio = false,
) {
  // Workers attach the phone through TwiML; Node retains its existing playback flow.
  // Start is unidirectional, so the patient's Say instructions can continue playing.
  const status = statusCallback
    ? ` statusCallback="${xml(statusCallback)}" statusCallbackMethod="POST"`
    : "";
  const stream = streamPhoneAudio
    ? `<Start><Stream url="${xml(wsUrl)}" track="inbound_track"${status}><Parameter name="join" value="${xml(joinCallId)}"/><Parameter name="org_slug" value="${xml(orgSlug)}"/></Stream></Start>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${stream}${sayEs(PATIENT_SPEECH)}<Pause length="6"/>${sayEs(PATIENT_REPLY)}<Pause length="600"/></Response>`;
}

export function joinStreamUrl(origin: string, joinCallId: string, orgSlug = "arenal") {
  const base = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return `${base}/ws/join/${encodeURIComponent(joinCallId)}/${encodeURIComponent(orgSlug)}`;
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

function toHttpOrigin(value: string) {
  return value
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/ws\/?$/, "")
    .replace(/\/twiml\/.*$/, "")
    .replace(/\/$/, "");
}

function isLoopbackOrigin(origin: string) {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch {
    return true;
  }
}

async function ngrokHttpsOrigin(): Promise<string | null> {
  try {
    const response = await fetch("http://127.0.0.1:4040/api/tunnels", {
      signal: AbortSignal.timeout(1500),
    });
    const data = (await response.json()) as {
      tunnels?: Array<{ public_url?: string; config?: { addr?: string } }>;
    };
    const httpsTunnels = (data.tunnels ?? []).filter((tunnel) => tunnel.public_url?.startsWith("https://"));
    const preferred = httpsTunnels.find((tunnel) => (tunnel.config?.addr ?? "").includes(":7860"))
      ?? httpsTunnels[0];
    return preferred?.public_url ?? null;
  } catch {
    return null;
  }
}

export async function publicHttpOrigin(): Promise<string | null> {
  const configured = process.env.VOICE_AGENT_PUBLIC_URL?.trim() || process.env.TWILIO_HANDOFF_URL?.trim();
  if (configured) {
    const origin = toHttpOrigin(configured);
    if (!isLoopbackOrigin(origin)) return origin;
  }
  if (process.env.VOICE_STORAGE === "d1") return null;
  return ngrokHttpsOrigin();
}

function wsUrlFromOrigin(origin: string) {
  return `${origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/ws`;
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
    callLogError("twilio transfer failed", response.status, payload.message ?? raw.slice(0, 240));
  }
  await audit?.("handoff.completed", { requestId, provider: "twilio", status: response.status, callSid: payload.sid ?? null });
  return {
    ok: response.ok,
    status: response.status,
    callSid: payload.sid,
    error: response.ok ? undefined : payload.message ?? raw.slice(0, 240),
  };
}

export async function startCallMediaStream(callSid: string, wsUrl: string) {
  return twilioPost(
    `/Calls/${encodeURIComponent(callSid)}/Streams.json`,
    new URLSearchParams({
      Url: wsUrl,
      Track: "inbound_track",
    }),
  );
}

export async function originateHandoffCall(join?: {
  callId: string;
  orgSlug?: string;
  handoffUrl?: string | undefined;
}, audit?: AuditAction): Promise<TransferResult> {
  const creds = credentials();
  if (!creds) {
    await audit?.("handoff.skipped", { reason: "missing_credentials" });
    return { configured: false, error: "Faltan TWILIO_ACCOUNT_SID, números o token." };
  }
  let url = handoffVoiceUrl();
  if (join) {
    const origin = join.handoffUrl ? null : await publicHttpOrigin();
    if (!join.handoffUrl && !origin) {
      await audit?.("handoff.skipped", { reason: "missing_public_url" });
      return {
        configured: true,
        transferred: false,
        originated: false,
        error: "No hay URL pública para unir el móvil a la llamada.",
      };
    }
    const target = new URL(join.handoffUrl ?? `${origin}/twiml/live`);
    target.searchParams.set("join", join.callId);
    target.searchParams.set("org", join.orgSlug ?? "arenal");
    url = target.toString();
  }
  const posted = await twilioPost(
    "/Calls.json",
    new URLSearchParams({
      To: creds.humanNumber,
      From: creds.callerId,
      Url: url,
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
  join?: { callId: string; orgSlug?: string; handoffUrl?: string | undefined },
  audit?: AuditAction,
): Promise<TransferResult> {
  const creds = credentials();
  if (!creds) {
    await audit?.("handoff.skipped", { reason: "missing_credentials" });
    return { configured: false, error: "Faltan TWILIO_ACCOUNT_SID, números o token." };
  }
  if (join) return originateHandoffCall(join, audit);
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
  return originateHandoffCall(undefined, audit);
}

export { wsUrlFromOrigin };
