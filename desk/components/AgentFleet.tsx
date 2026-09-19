"use client";

import { useEffect, useState } from "react";
import styles from "./AgentFleet.module.css";

type Health = {
  ok: boolean;
  activeCalls: number;
  uptimeSeconds: number;
  checkedAt: string;
};

export function AgentFleet() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/agent-status", { cache: "no-store" });
        const value = await response.json() as Health;
        if (active) setHealth(value);
      } catch {
        if (active) setHealth({ ok: false, activeCalls: 0, uptimeSeconds: 0, checkedAt: new Date().toISOString() });
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className={styles.fleet} id="agentes">
      <header>
        <div><h2>Agente en ejecución</h2><p>Un runtime para toda la red. La configuración no se parte por hospital.</p></div>
        <span data-online={health?.ok ?? false}><i />{health?.ok ? "Runtime operativo" : "Runtime sin respuesta"}</span>
      </header>
      <div className={styles.runtime}>
        <article>
          <span>Proceso de voz</span>
          <strong>{health?.ok ? "Agente único conectado" : "No disponible"}</strong>
          <small>El mismo perfil atiende todos los centros</small>
        </article>
        <article>
          <span>Llamadas activas</span>
          <strong>{health?.activeCalls ?? "—"}</strong>
          <small>WebSockets abiertos ahora</small>
        </article>
        <article>
          <span>Tiempo activo</span>
          <strong>{health ? `${Math.floor(health.uptimeSeconds / 60)} min` : "—"}</strong>
          <small>{health?.checkedAt ? `Comprobado ${new Date(health.checkedAt).toLocaleTimeString("es-ES")}` : "Comprobando…"}</small>
        </article>
      </div>
    </section>
  );
}
