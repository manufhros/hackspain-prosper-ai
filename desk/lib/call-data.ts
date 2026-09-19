import "server-only";

import { CLINIC } from "./clinic";
import { readLiveCalls } from "./live-calls";
import type { CallDetail, LoggedCall } from "./types";
import { database, usesCloudflareStorage } from "./cloudflare-storage";
import { localCalls } from "./local-calls";
import { readCallRecord } from "./call-records";

/** All calls handled for the clinic, newest first (D1 on Cloudflare, log export locally). */
export async function clinicCalls(range?: { from: string; to: string }): Promise<LoggedCall[]> {
  return readLiveCalls(CLINIC.slug, range);
}

export async function clinicCall(callId: string, page = 1): Promise<CallDetail | null> {
  if (usesCloudflareStorage()) return readCallRecord(database(), CLINIC.slug, callId, page);
  const record = (await localCalls(CLINIC.slug)).find(item => item.call.id === callId);
  if (!record) return null;
  const pages = Math.max(1, Math.ceil(record.transcript.length / 100));
  const current = Math.min(pages, Number.isSafeInteger(page) ? Math.max(1, page) : 1);
  return { call: record.call, transcript: record.transcript.slice((current - 1) * 100, current * 100),
    transcriptTotal: record.transcript.length, page: current, pages };
}
