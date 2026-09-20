"use client";

import { useEffect, useState } from "react";
import styles from "./AgentFleet.module.css";

import { agentHealth, type AgentHealth } from "@/lib/agent-health";

function uptimeLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

export function AgentFleet() {
  const [health, setHealth] = useState<AgentHealth | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/agent-status", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) });
        if (!response.ok) throw new Error("Health unavailable");
        const value = await response.json() as AgentHealth;
        if (active) setHealth(agentHealth(value, value.checkedAt));
      } catch {
        if (active) setHealth(agentHealth(null, new Date().toISOString()));
      } finally {
        if (active) timer = setTimeout(refresh, 5_000);
      }
    }
    void refresh();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, []);

  const online = health?.ok === true;
  const live = health?.activeCalls ?? 0;
  const uptime = health?.uptimeSeconds != null ? uptimeLabel(health.uptimeSeconds) : null;

  return (
    <section className={styles.fleet} id="agentes">
      <header>
        <h2>Servicio de voz</h2>
        <span data-online={online}>
          <i />
          {!health ? "Comprobando…" : online ? "Disponible" : "Sin respuesta"}
        </span>
      </header>
      <p className={styles.pulse}>
        {!health
          ? "Comprobando el servicio."
          : online
            ? `${live ? `${live} en curso` : "Ninguna en curso"}${uptime ? ` · ${uptime} en marcha` : ""}`
            : "No responde el servicio de voz."}
      </p>
    </section>
  );
}
