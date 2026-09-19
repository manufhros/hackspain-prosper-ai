import type { WebSocket } from "ws";

export type PhoneSink = {
  ws: WebSocket;
  streamSid: string;
};

export type LiveSession = {
  callId: string;
  sendElevenAudio: (ulaw: string) => void;
  addPhone: (ws: WebSocket, streamSid: string) => void;
  removePhone: (ws: WebSocket) => void;
};

const sessions = new Map<string, LiveSession>();
const rangAt = new Map<string, number>();
const KEEP_PHONE_MS = 180_000;

export function markHumanRung(callId: string) {
  rangAt.set(callId, Date.now());
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
