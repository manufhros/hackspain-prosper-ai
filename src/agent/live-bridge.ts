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
const rang = new Set<string>();

export function markHumanRung(callId: string) {
  rang.add(callId);
}

export function alreadyRungHuman(callId: string) {
  return rang.has(callId);
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
