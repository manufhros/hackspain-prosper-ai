import "server-only";

import { database, usesCloudflareStorage } from "./cloudflare-storage";
import { readStoredCalls } from "./call-query";
import { localCalls } from "./local-calls";
import { CLINIC } from "./clinic";

export async function readLiveCalls(org = CLINIC.slug as string, range?: { from: string; to: string }) {
  if (usesCloudflareStorage()) return readStoredCalls(database(), org, range);
  const calls = (await localCalls(org)).map(record => record.call);
  return range ? calls.filter(call => call.started && call.started >= range.from && call.started < range.to) : calls.slice(0, 500);
}
