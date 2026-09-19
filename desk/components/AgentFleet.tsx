"use client";

import { useEffect, useState } from "react";
import styles from "./AgentFleet.module.css";

type Health = {
  ok: boolean;
  activeCalls: number;
  uptimeSeconds: number;
  checkedAt: string;
};

type Profile = {
  slug: string;
  name: string;
  centers: number;
};

export function AgentFleet({ profiles }: { profiles: Profile[] }) {
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
        <div><h2>Agentes en ejecución</h2><p>Estado real del runtime y perfiles hospitalarios cargados.</p></div>
        <span data-online={health?.ok ?? false}><i />{health?.ok ? "Runtime operativo" : "Runtime sin respuesta"}</span>
      </header>
      <div className={styles.runtime}>
        <article>
          <span>Proceso de voz</span>
          <strong>{health?.ok ? "ElevenLabs conectado" : "No disponible"}</strong>
          <small>Actualiza cada 5 segundos</small>
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
      <div className={styles.profiles}>
        {profiles.map((profile) => (
          <article key={profile.slug}>
            <i />
            <div><strong>{profile.name}</strong><small>{profile.centers} centros · perfil de configuración</small></div>
            <span>Configurado</span>
          </article>
        ))}
      </div>
    </section>
  );
}
