"use client";

import { checkOrgEndpoints, saveOrgIntegrationConfig } from "@/app/g/[org]/integraciones/actions";
import type { OrgAgentConfig } from "@/lib/org-agent-config";
import type { FaqSuggestion } from "@/lib/faq-suggestions";
import { useState, useTransition } from "react";
import styles from "./DeveloperPortal.module.css";

export function DeveloperPortal({
  initialConfig,
  initialSuggestions,
}: {
  initialConfig: OrgAgentConfig;
  initialSuggestions: FaqSuggestion[];
}) {
  const [config, setConfig] = useState(initialConfig);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
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

      <section className={styles.behaviour}>
        <header><div><p>Comportamiento permitido</p><h2>Atención del agente</h2></div></header>
        <label className={styles.threshold}>
          <span><strong>Umbral de frustración</strong><small>Al alcanzarlo, el agente ofrece pasar al equipo humano.</small></span>
          <input type="range" min="50" max="100" value={config.frustrationThreshold} onChange={(event) => setConfig({ ...config, frustrationThreshold: Number(event.target.value) })} />
          <b>{config.frustrationThreshold}/100</b>
        </label>
        {suggestions.length ? (
          <div className={styles.suggestions}>
            <div className={styles.suggestionHead}>
              <span><strong>Sugerencias del agente</strong><small>Detectadas en preguntas repetidas de las llamadas.</small></span>
            </div>
            {suggestions.map((suggestion) => (
              <article key={suggestion.id}>
                <div>
                  <span>{suggestion.count} llamadas relacionadas</span>
                  <strong>{suggestion.question}</strong>
                  <small>{suggestion.answer}</small>
                </div>
                <nav>
                  <button
                    type="button"
                    onClick={() => {
                      if (!config.faq.some((item) => item.question === suggestion.question)) {
                        setConfig({
                          ...config,
                          faq: [
                            ...config.faq,
                            {
                              id: `suggested-${suggestion.id}`,
                              question: suggestion.question,
                              answer: suggestion.answer,
                            },
                          ],
                        });
                      }
                      setSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
                      setNotice("Sugerencia añadida al borrador de FAQ.");
                    }}
                  >
                    Añadir a FAQ
                  </button>
                  <button type="button" onClick={() => setSuggestions((current) => current.filter((item) => item.id !== suggestion.id))}>
                    Descartar
                  </button>
                </nav>
              </article>
            ))}
          </div>
        ) : null}
        <div className={styles.faqHead}><div><h3>Preguntas frecuentes</h3><p>Contenido aprobado que el agente puede responder.</p></div><button type="button" onClick={() => setConfig({ ...config, faq: [...config.faq, { id: crypto.randomUUID(), question: "", answer: "" }] })}>Añadir FAQ</button></div>
        <div className={styles.faqList}>
          {config.faq.length ? config.faq.map((item, index) => (
            <article key={item.id}>
              <input aria-label="Pregunta" placeholder="¿Cuál es el horario de radiología?" value={item.question} onChange={(event) => {
                const faq = [...config.faq]; faq[index] = { ...item, question: event.target.value }; setConfig({ ...config, faq });
              }} />
              <textarea aria-label="Respuesta" placeholder="Radiología atiende de lunes a viernes…" value={item.answer} onChange={(event) => {
                const faq = [...config.faq]; faq[index] = { ...item, answer: event.target.value }; setConfig({ ...config, faq });
              }} />
              <button type="button" onClick={() => setConfig({ ...config, faq: config.faq.filter((faq) => faq.id !== item.id) })}>Eliminar</button>
            </article>
          )) : <p className={styles.empty}>Todavía no hay preguntas frecuentes publicadas.</p>}
        </div>
      </section>
      <footer><span>Las reglas clínicas y las credenciales globales solo las gestiona hash.</span><button disabled={pending} onClick={() => run(() => saveOrgIntegrationConfig(config))}>{pending ? "Guardando…" : "Guardar configuración"}</button></footer>
      {notice ? <p className={styles.notice}>{notice}</p> : null}
    </div>
  );
}
