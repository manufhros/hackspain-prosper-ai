"use client";

import { checkOrgEndpoints, saveOrgIntegrationConfig } from "@/app/panel/agente/actions";
import type { OrgAgentConfig } from "@/lib/org-agent-config";
import { useState, useTransition } from "react";
import styles from "./DeveloperPortal.module.css";

export function DeveloperPortal({
  initialConfig,
}: {
  initialConfig: OrgAgentConfig;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingEndpoint, setEditingEndpoint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ message: string; config: OrgAgentConfig }>) {
    startTransition(async () => {
      const result = await action();
      setConfig(result.config);
      setNotice(result.message);
    });
  }

  const endpoints = [
    ["preCallEndpoint", "Contexto previo", "Paciente, póliza y contexto antes de contestar", "preCall"],
    ["actionEndpoint", "Acciones clínicas", "Agenda, CRM o middleware propio", "actions"],
    ["postCallEndpoint", "Postllamada", "Resultado, resumen y trazabilidad", "postCall"],
  ] as const;

  return (
    <div className={styles.portal}>
      <section className={styles.endpoints}>
        <header><div><p>Conectividad</p><h2>Endpoints del hospital</h2></div><button disabled={pending} onClick={() => run(() => checkOrgEndpoints(config.orgSlug))}>Comprobar salud</button></header>
        {endpoints.map(([field, label, copy, healthKey]) => {
          const health = config.health[healthKey];
          return (
            <label key={field}>
              <span><strong>{label}</strong><small>{copy}</small></span>
              <input
                type="url"
                placeholder="https://api.hospital.es/..."
                value={config[field]}
                readOnly={editingEndpoint !== field}
                autoFocus={editingEndpoint === field}
                onChange={(event) => setConfig({ ...config, [field]: event.target.value })}
              />
              <div className={styles.endpointState}>
                <em data-status={health.status}>{health.status === "healthy" ? "Healthy" : health.status === "unknown" ? "Not checked" : health.status === "degraded" ? "Degraded" : "Down"}{health.latencyMs ? ` · ${health.latencyMs} ms` : ""}</em>
                <button
                  type="button"
                  className={editingEndpoint === field ? styles.editing : styles.edit}
                  aria-label={editingEndpoint === field ? `Terminar edición de ${label}` : `Editar ${label}`}
                  title={editingEndpoint === field ? "Terminar edición" : "Editar endpoint"}
                  onClick={() => setEditingEndpoint((current) => current === field ? null : field)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20h4l11-11-4-4L4 16v4Zm9.5-13.5 4 4" />
                  </svg>
                </button>
              </div>
            </label>
          );
        })}
      </section>
      <footer><span>La voz, las FAQ y el comportamiento del agente se configuran en turno, no por hospital.</span><button disabled={pending} onClick={() => run(() => saveOrgIntegrationConfig(config))}>{pending ? "Guardando…" : "Guardar endpoints"}</button></footer>
      {notice ? <p className={styles.notice}>{notice}</p> : null}
    </div>
  );
}
