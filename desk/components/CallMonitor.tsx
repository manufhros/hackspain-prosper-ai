"use client";

import type { LoggedCall } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import styles from "./CallMonitor.module.css";

const LABELS: Record<string, string> = {
  cita: "Cita reservada",
  alta: "Paciente registrado",
  escalado: "Escalado",
  sin_cita: "Cierre sin cita",
  cancelacion: "Cita cancelada",
  cambio: "Cita modificada",
  sin_cierre: "Sin cierre",
};

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CallMonitor({
  calls,
  title,
  source = "llamadas",
}: {
  calls: LoggedCall[];
  title: string;
  source?: "llamadas" | "demo";
}) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 8_000);
    return () => window.clearInterval(timer);
  }, [router]);
  const recent = calls.slice(0, 60);
  const errors = recent.reduce((sum, call) => sum + (call.toolErrors ?? 0), 0);
  const escalated = recent.filter((call) => call.outcome === "escalado").length;

  function exportJson() {
    download(
      `llamadas-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), source, calls }, null, 2),
      "application/json",
    );
  }

  function exportCsv() {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["id", "fecha", "paciente", "centro", "resultado", "motivo", "frustracion", "latencia_ms", "errores", "acciones"],
      ...calls.map((call) => [
        call.id,
        call.started,
        call.patient,
        call.siteName,
        call.outcome,
        call.reason ?? call.motive,
        call.frustrationScore ?? 0,
        call.avgToolLatencyMs,
        call.toolErrors ?? 0,
        call.actions?.map((action) => `${action.name}${action.reason ? `:${action.reason}` : ""}`).join(" | ") ?? "",
      ]),
    ];
    download(
      `llamadas-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((row) => row.map(quote).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  return (
    <div className={styles.monitor}>
      <header className={styles.hero}>
        <div><p>Actualización automática · 8 s</p><h1>{title}</h1><span>{source === "llamadas" ? "Llamadas reales, decisiones y acciones ejecutadas por el agente." : "Actividad de demostración para este grupo hospitalario."}</span></div>
        <div className={styles.heroActions}>
          <div className={styles.live}><i /> {source === "llamadas" ? "En directo" : "Demo"}</div>
          <button type="button" onClick={exportJson}>Exportar JSON</button>
          <button type="button" onClick={exportCsv}>Exportar CSV</button>
        </div>
      </header>
      <section className={styles.kpis}>
        <article><span>Llamadas visibles</span><strong>{recent.length}</strong></article>
        <article><span>Escalados</span><strong>{escalated}</strong></article>
        <article><span>Errores de herramienta</span><strong>{errors}</strong></article>
        <article><span>Frustración media</span><strong>{recent.length ? Math.round(recent.reduce((sum, call) => sum + (call.frustrationScore ?? 0), 0) / recent.length) : 0}/100</strong></article>
      </section>
      <section className={styles.feed}>
        <div className={styles.feedHead}><span>Llamada</span><span>Centro</span><span>Resultado</span><span>Calidad</span><span>Acciones</span></div>
        {recent.map((call) => (
          <details key={call.id}>
            <summary>
              <span><i data-outcome={call.outcome} /><b>{call.patient || "Paciente sin identificar"}</b><small>{call.started || call.id}</small></span>
              <span><b>{call.siteName}</b><small>{call.motive || "Motivo no registrado"}</small></span>
              <span><b>{LABELS[call.outcome] ?? call.outcome}</b><small>{call.reason || "Sin incidencia"}</small></span>
              <span><b>{call.frustrationScore ?? 0}/100 frustración</b><small>{call.avgToolLatencyMs == null ? "Latencia no disponible" : `${call.avgToolLatencyMs} ms por herramienta`}</small></span>
              <span><b>{call.actions?.length ?? call.toolCalls ?? 0}</b><small>Ver trazabilidad</small></span>
            </summary>
            <div className={styles.trace}>
              <header><strong>Registro de decisiones</strong><span>Config {call.configVersion?.slice(0, 8) || "legacy"}</span></header>
              {call.actions?.length ? call.actions.map((action, index) => (
                <article key={`${action.name}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{action.summary}</strong><small>{action.at || "Hora no disponible"}</small></div>
                  <em>{action.reason ? `Motivo: ${action.reason}` : action.name}</em>
                </article>
              )) : <p>No hay acciones estructuradas en este log antiguo.</p>}
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
