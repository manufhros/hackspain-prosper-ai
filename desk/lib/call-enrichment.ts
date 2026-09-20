import { spokenIdentity } from "../../src/agent/caller-identity.ts";
import { motiveFrom, substantive } from "../../src/agent/call-text.ts";
import type { LoggedCall } from "./types";

const INTENT_CODES = new Set(["appointment_action", "general_faq", "medical_emergency"]);

const CONFIRMED = new Set(["cita", "alta", "escalado", "sin_cita", "cancelacion", "cambio"]);

type Turn = { speaker: string; text: string };

export function enrichCall(call: LoggedCall, turns: Turn[]): LoggedCall {
  let previousAgent = "";
  let spoken;
  let motive = INTENT_CODES.has(call.motive) ? "" : call.motive;
  for (const turn of turns) {
    if (turn.speaker === "agent") previousAgent = turn.text;
    else {
      spoken = spokenIdentity(turn.text, previousAgent) ?? spoken;
      if (!motive && substantive(turn.text)) motive = motiveFrom(turn.text);
    }
  }
  return {
    ...call,
    patient: call.patient || spoken?.patientName || null,
    patientId: call.patientId || spoken?.patientId || null,
    insurer: call.insurer || spoken?.insurer || null,
    motive: motive || call.motive,
  };
}

export function enrichCalls(
  calls: LoggedCall[],
  turns: Array<Turn & { call_id: string }>,
): LoggedCall[] {
  const byCall = new Map<string, Turn[]>();
  for (const turn of turns) {
    const list = byCall.get(turn.call_id) ?? [];
    list.push(turn);
    byCall.set(turn.call_id, list);
  }
  return calls.map((call) => enrichCall(call, byCall.get(call.id) ?? []));
}

/** Greeting-only hangups stay out of the hospital board. Confirmed outcomes stay. */
export function isRecordedCall(call: LoggedCall) {
  if (CONFIRMED.has(call.outcome)) return true;
  if (call.patient) return true;
  const motive = call.motive?.trim() ?? "";
  return Boolean(motive) && !INTENT_CODES.has(motive);
}
