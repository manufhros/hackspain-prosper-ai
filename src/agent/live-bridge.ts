import type { AuditAction } from "./audit.ts";
import type { CallSocket } from "./socket.ts";

export type PhoneSink = { ws: CallSocket; streamSid: string };
export type LiveSession = {
  callId: string;
  audit?: AuditAction;
  sendElevenAudio: (ulaw: string) => void;
  addPhone: (ws: CallSocket, streamSid: string) => void;
  removePhone: (ws: CallSocket) => void;
};

export const KEEP_PHONE_MS = 180_000;

/** One registry per Durable Object; the Node server shares its default registry. */
export class LiveBridge {
  private sessions = new Map<string, LiveSession>();
  private rangAt = new Map<string, number>();
  markHumanRung = (callId: string) => { this.rangAt.set(callId, Date.now()); };
  alreadyRungHuman = (callId: string) => this.rangAt.has(callId);
  sessionKeptForPhone = (callId: string) => {
    const rang = this.rangAt.get(callId);
    return rang != null && Date.now() - rang < KEEP_PHONE_MS;
  };
  registerLiveSession = (session: LiveSession) => { this.sessions.set(session.callId, session); };
  unregisterLiveSession = (callId: string) => {
    this.sessions.delete(callId);
    this.rangAt.delete(callId);
  };
  getLiveSession = (callId: string) => this.sessions.get(callId);
  liveSessionIds = () => [...this.sessions.keys()];
}

export const nodeLiveBridge = new LiveBridge();
