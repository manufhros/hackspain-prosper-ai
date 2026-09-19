"use client";

import { checkOrgEndpoints, saveOrgIntegrationConfig } from "@/app/panel/agente/actions";
import type { FaqSuggestion } from "@/lib/faq-suggestion";
import type { OrgAgentConfig } from "@/lib/org-agent-config";
import { Button } from "@/components/ui/primitives";
import { useState, useTransition } from "react";
import styles from "./DeveloperPortal.module.css";

export function DeveloperPortal({
  initialConfig,
  suggestion = null,
}: {
  initialConfig: OrgAgentConfig;
  suggestion?: FaqSuggestion | null;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingEndpoint, setEditingEndpoint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);

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

  function addSuggestion() {
    if (!suggestion) return;
    patch({
      faq: [
        ...config.faq,
        { id: crypto.randomUUID(), question: suggestion.question, answer: "" },
      ],
    });
    setDismissedSuggestion(true);
  }

  const endpoints = [
    ["preCallEndpoint", "Contexto previo", "Paciente, póliza y contexto antes de contestar", "preCall"],
    ["actionEndpoint", "Acciones clínicas", "Agenda, CRM o middleware propio", "actions"],
    ["postCallEndpoint", "Postllamada", "Resultado, resumen y trazabilidad", "postCall"],
  ] as const;
  const visibleSuggestion = suggestion && !dismissedSuggestion
    && !config.faq.some((item) => item.question === suggestion.question)
    ? suggestion
    : null;

  return (
    <div className={styles.portal}>
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

      <section className={styles.character}>
        <header>
          <div>
            <p>Hospital</p>
            <h2>Prompt y reglas</h2>
          </div>
        </header>
        <div className={styles.characterBody}>
          <label>
            <span>
              <strong>Meta prompt</strong>
              <small>Acento, registro y muletillas. Se aplica en cada turno.</small>
            </span>
            <textarea
              rows={5}
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
          <label>
            <span>
              <strong>Reglas de este hospital</strong>
              <small>Política local. No sustituye las reglas clínicas de seguridad.</small>
            </span>
            <textarea
              rows={4}
              value={config.extraInstructions ?? ""}
              onChange={(event) => patch({ extraInstructions: event.target.value })}
            />
          </label>
        </div>
      </section>

      <section>
        <div className={styles.faqHead}>
          <div>
            <p>Conocimiento</p>
            <h2>FAQ del hospital</h2>
            <p>Una sola colección para este hospital. El runtime usa estas respuestas.</p>
          </div>
          <button
            type="button"
            onClick={() => patch({
              faq: [...config.faq, { id: crypto.randomUUID(), question: "", answer: "" }],
            })}
          >
            Añadir FAQ
          </button>
        </div>
        <div className={styles.suggestions}>
          <div className={styles.suggestionHead}>
            <strong>Sugerencia desde llamadas</strong>
            <small>{visibleSuggestion ? visibleSuggestion.evidence : "Un motivo frecuente de las conversaciones, si no está ya en la FAQ."}</small>
          </div>
          {visibleSuggestion ? (
            <article>
              <div>
                <span>{visibleSuggestion.count} veces</span>
                <strong>{visibleSuggestion.question}</strong>
                <small>Motivo frecuente no cubierto por las FAQ actuales.</small>
              </div>
              <nav>
                <button type="button" onClick={addSuggestion}>Añadir</button>
                <button type="button" onClick={() => setDismissedSuggestion(true)}>Descartar</button>
              </nav>
            </article>
          ) : (
            <article>
              <div>
                <strong>Sin sugerencia todavía</strong>
                <small>Hace falta el mismo tipo de pregunta al menos dos veces, y que no esté ya respondida arriba.</small>
              </div>
            </article>
          )}
        </div>
        <div className={styles.faqList}>
          {config.faq.length ? config.faq.map((item, index) => (
            <article key={item.id}>
              <input
                aria-label="Pregunta"
                placeholder="¿Cuál es el horario?"
                value={item.question}
                onChange={(event) => {
                  const faq = [...config.faq];
                  faq[index] = { ...item, question: event.target.value };
                  patch({ faq });
                }}
              />
              <textarea
                aria-label="Respuesta"
                placeholder="Respuesta aprobada…"
                value={item.answer}
                onChange={(event) => {
                  const faq = [...config.faq];
                  faq[index] = { ...item, answer: event.target.value };
                  patch({ faq });
                }}
              />
              <button type="button" onClick={() => patch({ faq: config.faq.filter((entry) => entry.id !== item.id) })}>
                Eliminar
              </button>
            </article>
          )) : <p className={styles.empty}>Todavía no hay preguntas frecuentes en este hospital.</p>}
        </div>
      </section>

      <footer>
        <span>{notice ?? "Los cambios de este hospital valen para las próximas llamadas del grupo."}</span>
        <Button disabled={pending} onClick={() => run(() => saveOrgIntegrationConfig(config))}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </footer>
    </div>
  );
}
