import type { CallAction } from "./types";

type ToolEvent = { event_id: string; type: string; occurred_at: string; payload: string };

/** Pair request/result events by provider ID, with ordered matching for legacy logs. */
export function actionsFromEvents(events: ToolEvent[]): CallAction[] {
  const actions: CallAction[] = [];
  const byId = new Map<string, CallAction>();
  for (const event of events) {
    const payload = JSON.parse(event.payload);
    const name = payload.toolName ?? payload.name;
    if (typeof name !== "string" || !name) continue;
    const request = event.type === "tool.called" || event.type === "tool.received";
    const id = typeof payload.toolCallId === "string" ? payload.toolCallId : null;
    let action = id ? byId.get(id) : undefined;
    if (!action && !id && !request) action = actions.find(item => item.name === name && item.status === "pending");
    if (!action) {
      action = { id: id ?? event.event_id, name, at: event.occurred_at, reason: null,
        summary: "Iniciada · sin resultado guardado", status: "pending" };
      actions.push(action);
      if (id) byId.set(id, action);
    }
    if (payload.parameters != null) action.parameters = payload.parameters;
    if (payload.result != null) action.result = payload.result;
    if (typeof payload.latencyMs === "number") action.latencyMs = payload.latencyMs;
    if (event.type === "tool.blocked" || payload.result?.held === true) {
      action.status = "blocked";
      action.summary = "No ejecutada";
    } else if (event.type === "tool.failed" || payload.ok === false || payload.result?.error) {
      action.status = "failed";
      action.summary = "Error";
    } else if (event.type === "tool.completed") {
      action.status = payload.truncated ? "unknown" : "completed";
      action.summary = payload.truncated ? "Resultado incompleto en el registro" : "Completada";
    }
    action.reason = payload.reason ?? payload.result?.reason ?? action.reason;
  }
  return actions.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
