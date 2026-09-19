import type { WebSocket } from "ws";

export type PhoneSink = {
  ws: WebSocket;
  streamSid: string;
};

export type LiveSession = {
  callId: string;
  sendElevenAudio: (ulaw: string) => void;
  sendToCaller: (ulaw: string) => void;
  addPhone: (ws: WebSocket, streamSid: string) => void;
  removePhone: (ws: WebSocket) => void;
  freezeDisplay: () => void;
};

const sessions = new Map<string, LiveSession>();
const rangAt = new Map<string, number>();
const outboundCalls = new Map<string, string>();
const KEEP_PHONE_MS = 180_000;

export function markHumanRung(callId: string, outboundCallSid?: string) {
  rangAt.set(callId, Date.now());
  if (outboundCallSid) outboundCalls.set(callId, outboundCallSid);
}

export function outboundCallSid(callId: string) {
  return outboundCalls.get(callId);
}

export function alreadyRungHuman(callId: string) {
  return rangAt.has(callId);
}

export function sessionKeptForPhone(callId: string) {
  const rang = rangAt.get(callId);
  return rang != null && Date.now() - rang < KEEP_PHONE_MS;
}

export function registerLiveSession(session: LiveSession) {
  sessions.set(session.callId, session);
}

export function unregisterLiveSession(callId: string) {
  sessions.delete(callId);
}

export function getLiveSession(callId: string) {
  return sessions.get(callId);
}

export function liveSessionIds() {
  return [...sessions.keys()];
}

const phoneJoined = new Set<string>();

export function markPhoneJoined(callId: string) {
  phoneJoined.add(callId);
}

export function hasPhoneJoined(callId: string) {
  return phoneJoined.has(callId);
}

export function parseJoinPath(requestUrl: string): { joinId?: string; orgSlug?: string } {
  try {
    const url = new URL(requestUrl, "http://127.0.0.1");
    const match = url.pathname.match(/\/join\/([^/]+)(?:\/([^/]+))?/);
    const joinId = match?.[1]
      ? decodeURIComponent(match[1])
      : (url.searchParams.get("join") ?? undefined);
    const orgSlug = match?.[2]
      ? decodeURIComponent(match[2])
      : (url.searchParams.get("org") ?? undefined);
    if (!joinId) return {};
    return { joinId, ...(orgSlug ? { orgSlug } : {}) };
  } catch {
    return {};
  }
}
