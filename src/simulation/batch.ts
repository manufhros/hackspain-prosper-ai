import { SharedAudio } from "../telephony/audio";
import type { Inference } from "../voice/runtime";

export function callCount(value = "1"): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 50)
    throw new Error("--calls must be an integer from 1 to 50");
  return Number(value);
}

export function callPlans(seed: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = crypto.randomUUID();
    return { id, callId: `workbench-${id}`, seed: count === 1 ? seed : `${seed}:${index + 1}`, index: index + 1 };
  });
}

export function sharedCallerInference(runtime: Inference, lifetime: AbortSignal, ttsWorkers: number): Inference {
  const audio = new SharedAudio(runtime, lifetime, ttsWorkers);
  return {
    chat: (...args) => runtime.chat(...args),
    audio: (...args) => audio.run(...args),
    removeAudio: file => runtime.removeAudio(file),
  };
}

export interface BatchCallResult {
  call_id: string;
  status: string;
  report_path?: string;
  elapsed_ms?: number;
  errors?: string[];
}

/** Start every prepared call before awaiting any result; one failure cannot end its peers. */
export async function runCallBatch<T extends { callId: string }>(calls: T[], run: (call: T) => Promise<BatchCallResult>) {
  const started = performance.now();
  const results = await Promise.all(calls.map(async call => {
    try { return await run(call); }
    catch (error) { return { call_id: call.callId, status: "fail", errors: [error instanceof Error ? error.message : String(error)] }; }
  }));
  const failed = results.filter(result => !["pass", "connected_and_closed"].includes(result.status)).length;
  return { calls: calls.length, succeeded: calls.length - failed, failed, elapsed_ms: Math.round(performance.now() - started), results };
}
