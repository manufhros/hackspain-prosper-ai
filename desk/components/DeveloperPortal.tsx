"use client";

import { checkOrgEndpoints, saveOrgIntegrationConfig } from "@/app/panel/agente/actions";
import type { OrgAgentConfig } from "@/lib/org-agent-config";
import { voiceNameFor } from "@/lib/voices";
import { Button } from "@/components/ui/primitives";
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

  function patch(next: Partial<OrgAgentConfig>) {
    setConfig((current) => ({ ...current, ...next }));
    setNotice(null);
  }

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
      <section className={styles.character}>
        <header>
          <div>
            <p>ElevenLabs</p>
            <h2>Tono y carácter</h2>
          </div>
        </header>
        <div className={styles.characterBody}>
          <label>
            <span>
              <strong>Meta prompt</strong>
              <small>Acento, registro y muletillas. Se aplica en cada turno. El timbre lo marca la voz TTS.</small>
            </span>
            <textarea
              rows={5}
              placeholder={'Ej. Eres de Sevilla, más andaluza que el salmorejo. Cada vez que pidas un dato di "mi arma".'}
              value={config.metaPrompt ?? ""}
              onChange={(event) => patch({ metaPrompt: event.target.value })}
            />
          </label>
          <label>
            <span>
              <strong>Saludo</strong>
              <small>Primera frase al descolgar.</small>
            </span>
            <input
              value={config.firstMessage ?? ""}
              onChange={(event) => patch({ firstMessage: event.target.value })}
            />
          </label>
          <div className={styles.characterRow}>
            <label>
              <span>
                <strong>Voz publicada</strong>
                <small>El timbre se cambia arriba, en Comportamiento, y hay que Publicar.</small>
              </span>
              <input readOnly value={voiceNameFor(config.voiceId)} />
            </label>
            <label>
              <span>
                <strong>Idioma</strong>
                <small>ASR y TTS por defecto.</small>
              </span>
              <select value={config.language} onChange={(event) => patch({ language: event.target.value })}>
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="ca">Català</option>
                <option value="gl">Galego</option>
                <option value="eu">Euskera</option>
              </select>
            </label>
          </div>
          <label>
            <span>
              <strong>Reglas de este hospital</strong>
              <small>Política local. No sustituye las reglas clínicas de seguridad.</small>
            </span>
            <textarea
              rows={4}
              placeholder="Ej. Si no dicen sede, ofrecer primero Pozuelo."
              value={config.extraInstructions ?? ""}
              onChange={(event) => patch({ extraInstructions: event.target.value })}
            />
          </label>
        </div>
      </section>
      <section className={styles.endpoints}>
        <header>
          <div>
            <p>Conectividad</p>
            <h2>Endpoints del hospital</h2>
          </div>
          <button disabled={pending} onClick={() => run(() => checkOrgEndpoints(config.orgSlug))}>
            Comprobar salud
          </button>
        </header>
        {endpoints.map(([field, label, copy, healthKey]) => {
          const health = config.health[healthKey];
          return (
            <label key={field}>
              <span>
                <strong>{label}</strong>
                <small>{copy}</small>
              </span>
              <input
                type="url"
                placeholder="https://api.hospital.es/..."
                value={config[field]}
                readOnly={editingEndpoint !== field}
                autoFocus={editingEndpoint === field}
                onChange={(event) => setConfig({ ...config, [field]: event.target.value })}
              />
              <div className={styles.endpointState}>
                <em data-status={health.status}>
                  {health.status === "healthy"
                    ? "Healthy"
                    : health.status === "unknown"
                      ? "Not checked"
                      : health.status === "degraded"
                        ? "Degraded"
                        : "Down"}
                  {health.latencyMs ? ` · ${health.latencyMs} ms` : ""}
                </em>
                <button
                  type="button"
                  className={editingEndpoint === field ? styles.editing : styles.edit}
                  aria-label={editingEndpoint === field ? `Terminar edición de ${label}` : `Editar ${label}`}
                  title={editingEndpoint === field ? "Terminar edición" : "Editar endpoint"}
                  onClick={() => setEditingEndpoint((current) => (current === field ? null : field))}
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
      <footer>
        <span>{notice ?? "Los cambios de tono valen para las próximas llamadas de este grupo."}</span>
        <Button disabled={pending} onClick={() => run(() => saveOrgIntegrationConfig(config))}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </footer>
    </div>
  );
}
