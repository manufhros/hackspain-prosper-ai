import "server-only";
import { callsFor } from "./metrics";
import { readLiveCalls } from "./live-calls";
import { usesCloudflareStorage } from "./cloudflare-storage";
import type { Org } from "./types";

export async function callsForOrg(org: Org) {
  return usesCloudflareStorage() && org.source === "llamadas"
    ? readLiveCalls(org.slug)
    : callsFor(org);
}
