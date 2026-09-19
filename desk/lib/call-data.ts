import "server-only";

import { CLINIC } from "./clinic";
import { readLiveCalls } from "./live-calls";
import type { CallDetail, LoggedCall } from "./types";
import { database, usesCloudflareStorage } from "./cloudflare-storage";
import { readCallRecord } from "./call-records";

/** All calls handled for the clinic, newest first (D1 on Cloudflare, log export locally). */
export async function clinicCalls(): Promise<LoggedCall[]> {
  return readLiveCalls(CLINIC.slug);
}

export async function clinicCall(callId: string, page = 1): Promise<CallDetail | null> {
  if (usesCloudflareStorage()) return readCallRecord(database(), CLINIC.slug, callId, page);
  const call = (await clinicCalls()).find((item) => item.id === callId);
  return call ? { call, transcript: [], transcriptTotal: 0, page: 1, pages: 1 } : null;
}
