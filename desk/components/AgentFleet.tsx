"use client";

import { useEffect, useState } from "react";
import styles from "./AgentFleet.module.css";

import { agentHealth, type AgentHealth } from "@/lib/agent-health";

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

  return (
    <section className={styles.fleet} id="agentes">
      <header>
        <div><h2>Estado del servicio de voz</h2><p>Disponibilidad y mediciones del servicio, comprobadas cada cinco segundos.</p></div>
        <span data-online={health?.ok ?? false}><i />{!health ? "Comprobando…" : health.ok ? "Servicio disponible" : "Sin respuesta"}</span>
      </header>
      <div className={styles.runtime}>
        <article>
          <span>Servicio de voz</span>
          <strong>{health?.ok ? "Servicio accesible" : "No disponible"}</strong>
          <small>Comprobación del endpoint de salud</small>
        </article>
        <article>
          <span>Llamadas activas</span>
          <strong>{health?.activeCalls ?? "—"}</strong>
          <small>Sesiones activas registradas</small>
        </article>
        <article>
          <span>Tiempo activo</span>
          <strong>{health?.uptimeSeconds != null ? `${Math.floor(health.uptimeSeconds / 60)} min` : "No disponible"}</strong>
          <small>{health?.checkedAt ? `Comprobado ${new Date(health.checkedAt).toLocaleTimeString("es-ES")}` : "Comprobando…"}</small>
        </article>
      </div>
    </section>
  );
}
