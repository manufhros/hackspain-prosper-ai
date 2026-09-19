import "server-only";

import { CLINIC } from "./clinic";
import { readLiveCalls } from "./live-calls";
import type { CallDetail, LoggedCall } from "./types";
import { database, usesCloudflareStorage } from "./cloudflare-storage";
import { localCalls } from "./local-calls";
import { readCallRecord } from "./call-records";
import { isPolicyQuestion } from "./faq-suggestion";
import { isKnownOrganisation, ORGANISATIONS, type Organisation } from "./orgs";

/** All calls handled for the clinic, newest first (D1 on Cloudflare, log export locally). */
export async function clinicCalls(range?: { from: string; to: string }): Promise<LoggedCall[]> {
  return orgCalls(CLINIC.slug, range);
}

export async function orgCalls(orgSlug: string, range?: { from: string; to: string }): Promise<LoggedCall[]> {
  if (!isKnownOrganisation(orgSlug)) return [];
  return readLiveCalls(orgSlug, range);
}

export async function adminOrgSummaries(range?: { from: string; to: string }): Promise<Array<{
  organisation: Organisation;
  calls: LoggedCall[];
}>> {
  return Promise.all(ORGANISATIONS.map(async (organisation) => ({
    organisation,
    calls: await readLiveCalls(organisation.slug, range),
  })));
}

/** Calls plus caller questions from transcripts, for a single hospital FAQ suggestion. */
export async function orgFaqCalls(orgSlug: string): Promise<LoggedCall[]> {
  if (!isKnownOrganisation(orgSlug)) return [];
  if (usesCloudflareStorage()) return readLiveCalls(orgSlug);
  return (await localCalls(orgSlug)).map(({ call, transcript }) => {
    const asked = transcript.find((entry) => entry.speaker === "caller" && isPolicyQuestion(entry.text, call.intent));
    if (!asked) return call;
    return { ...call, intent: call.intent ?? "general_faq", motive: asked.text };
  });
}

async function callForOrg(orgSlug: string, callId: string, page = 1): Promise<CallDetail | null> {
  if (!isKnownOrganisation(orgSlug)) return null;
  if (usesCloudflareStorage()) return readCallRecord(database(), orgSlug, callId, page);
  const record = (await localCalls(orgSlug)).find((item) => item.call.id === callId);
  if (!record) return null;
  const pages = Math.max(1, Math.ceil(record.transcript.length / 100));
  const current = Math.min(pages, Number.isSafeInteger(page) ? Math.max(1, page) : 1);
  return {
    call: record.call,
    transcript: record.transcript.slice((current - 1) * 100, current * 100),
    transcriptTotal: record.transcript.length,
    page: current,
    pages,
  };
}

export async function clinicCall(callId: string, page = 1): Promise<CallDetail | null> {
  return callForOrg(CLINIC.slug, callId, page);
}

export async function adminCall(callId: string, page = 1): Promise<CallDetail | null> {
  for (const organisation of ORGANISATIONS) {
    const found = await callForOrg(organisation.slug, callId, page);
    if (found) return found;
  }
  return null;
}
