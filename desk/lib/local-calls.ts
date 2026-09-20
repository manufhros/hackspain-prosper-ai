import "server-only";

import path from "node:path";
import { buildImport, readSources } from "../../src/agent/log-records.mjs";
import { enrichCall } from "./call-enrichment";
import { callFromRow } from "./call-records";
import { actionsFromEvents } from "./call-tools";
import { dedupeTurns } from "./transcript";
import type { LoggedCall, TranscriptEntry } from "./types";

/** Read the current logs. No generated snapshot and no filesystem writes. */
export async function localCalls(org: string): Promise<Array<{ call: LoggedCall; transcript: TranscriptEntry[] }>> {
  const files = await readSources(path.resolve(process.cwd(), "../logs"));
  const plan = buildImport(files, { org, includeAll: true });
  return plan.calls.map(record => ({
    call: enrichCall({
      ...callFromRow({ call_id: record.id, started_at: record.startedAt, summary: JSON.stringify(record.summary) }),
      actions: actionsFromEvents(record.events.map(event => ({ event_id: event.eventId,
        type: event.type, occurred_at: event.occurredAt, payload: JSON.stringify(event.payload) }))
        .filter(event => /^tool\.(called|received|completed|failed|blocked)$/.test(event.type))),
    }, record.turns as TranscriptEntry[]),
    transcript: dedupeTurns(record.turns as TranscriptEntry[]),
  })).sort((a, b) => String(b.call.started).localeCompare(String(a.call.started)));
}
