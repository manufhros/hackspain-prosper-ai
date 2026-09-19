import "server-only";

import { CLINIC } from "./clinic";
import { readLiveCalls } from "./live-calls";
import type { LoggedCall } from "./types";

/** All calls handled for the clinic, newest first (D1 on Cloudflare, log export locally). */
export async function clinicCalls(): Promise<LoggedCall[]> {
  return readLiveCalls(CLINIC.slug);
}
