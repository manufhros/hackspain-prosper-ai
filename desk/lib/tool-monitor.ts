import { TOOL_PATH } from "./prosper-endpoints";
import type { LoggedCall } from "./types";

export type PathUse = {
  path: string;
  count: number;
  errors: number;
  avgMs: number | null;
};

function emptyUse(path: string): PathUse {
  return { path, count: 0, errors: 0, avgMs: null };
}

/** How many times each Prosper path was used in these calls, with latency when logged. */
export function pathUseFromCalls(calls: LoggedCall[]): Map<string, PathUse> {
  const byPath = new Map<string, { count: number; errors: number; latencySum: number; latencyN: number }>();
  function bump(path: string, error: boolean, latencyMs: number | null | undefined) {
    const current = byPath.get(path) ?? { count: 0, errors: 0, latencySum: 0, latencyN: 0 };
    current.count += 1;
    if (error) current.errors += 1;
    if (typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0) {
      current.latencySum += latencyMs;
      current.latencyN += 1;
    }
    byPath.set(path, current);
  }
  for (const call of calls) {
    if (!call.actions?.length) continue;
    for (const action of call.actions) {
      const path = TOOL_PATH[action.name];
      if (!path) continue;
      bump(path, action.status === "failed" || action.status === "blocked", action.latencyMs);
    }
  }
  const result = new Map<string, PathUse>();
  for (const [path, value] of byPath) {
    result.set(path, {
      path,
      count: value.count,
      errors: value.errors,
      avgMs: value.latencyN ? Math.round(value.latencySum / value.latencyN) : null,
    });
  }
  return result;
}

export function useForPath(uses: Map<string, PathUse>, path: string): PathUse {
  return uses.get(path) ?? emptyUse(path);
}
