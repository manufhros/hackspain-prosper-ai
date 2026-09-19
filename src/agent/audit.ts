import { AsyncLocalStorage } from "node:async_hooks";

const actionContext = new AsyncLocalStorage<Record<string, string>>();

export function withAuditContext<T>(context: Record<string, string>, action: () => T): T {
  return actionContext.run(context, action);
}

export function currentAuditContext() {
  return actionContext.getStore() ?? {};
}

/** Records an action before/after external side effects. Never include credentials. */
export type AuditAction = (type: string, payload: Record<string, unknown>) => Promise<void>;
