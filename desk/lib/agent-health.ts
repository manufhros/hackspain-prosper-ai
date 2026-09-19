export type AgentHealth = {
  ok: boolean;
  activeCalls: number | null;
  uptimeSeconds: number | null;
  checkedAt: string;
};

export function agentHealth(value: unknown, checkedAt: string): AgentHealth {
  const health = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const measured = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  return { ok: health.ok === true,
    activeCalls: health.ok === true ? measured(health.activeCalls) : null,
    uptimeSeconds: health.ok === true ? measured(health.uptimeSeconds) : null, checkedAt };
}
