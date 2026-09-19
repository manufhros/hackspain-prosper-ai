import type { AuditAction } from "./audit.ts";
import type { CallSocket } from "./socket.ts";

export type PhoneSink = { ws: CallSocket; streamSid: string };
export type LiveSession = {
  callId: string;
  audit?: AuditAction;
  sendElevenAudio: (ulaw: string) => void;
  sendToCaller: (ulaw: string) => void;
  addPhone: (ws: CallSocket, streamSid: string) => void;
  removePhone: (ws: CallSocket) => void;
  freezeDisplay: () => void;
};

export const KEEP_PHONE_MS = 180_000;

/** One registry per Durable Object; the Node server shares its default registry. */
export class LiveBridge {
  private sessions = new Map<string, LiveSession>();
  private rangAt = new Map<string, number>();
  private outboundCalls = new Map<string, string>();
  private phoneJoined = new Set<string>();

  markHumanRung = (callId: string, outboundCallSid?: string) => {
    this.rangAt.set(callId, Date.now());
    if (outboundCallSid) this.outboundCalls.set(callId, outboundCallSid);
  };
  outboundCallSid = (callId: string) => this.outboundCalls.get(callId);
  alreadyRungHuman = (callId: string) => this.rangAt.has(callId);
  sessionKeptForPhone = (callId: string) => {
    const rang = this.rangAt.get(callId);
    return rang != null && Date.now() - rang < KEEP_PHONE_MS;
  };
  registerLiveSession = (session: LiveSession) => { this.sessions.set(session.callId, session); };
  unregisterLiveSession = (callId: string) => {
    this.sessions.delete(callId);
    this.rangAt.delete(callId);
    this.outboundCalls.delete(callId);
    this.phoneJoined.delete(callId);
  };
  getLiveSession = (callId: string) => this.sessions.get(callId);
  liveSessionIds = () => [...this.sessions.keys()];
  markPhoneJoined = (callId: string) => { this.phoneJoined.add(callId); };
  hasPhoneJoined = (callId: string) => this.phoneJoined.has(callId);
}

export const nodeLiveBridge = new LiveBridge();
export const {
  markHumanRung, outboundCallSid, alreadyRungHuman, sessionKeptForPhone,
  registerLiveSession, unregisterLiveSession, getLiveSession, liveSessionIds,
  markPhoneJoined, hasPhoneJoined,
} = nodeLiveBridge;

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
