"use client";

import { saveOrgIntegrationConfig } from "@/app/panel/agente/actions";
import { Button, ButtonLink } from "@/components/ui/primitives";
import type { FaqSuggestion } from "@/lib/faq-suggestion";
import type { OrgAgentConfig } from "@/lib/org-agent-config";
import { PROSPER_ENDPOINTS } from "@/lib/prosper-endpoints";
import { ArrowRight, Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import styles from "./DeveloperPortal.module.css";

function EditButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? styles.editing : styles.edit}
      aria-label={active ? `Terminar edición de ${label}` : `Editar ${label}`}
      title={active ? "Terminar edición" : "Editar"}
      onClick={onClick}
    >
      <Pencil size={15} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

const HEALTH_LABEL = {
  healthy: "Healthy",
  unknown: "Sin comprobar",
  degraded: "Degraded",
  down: "Down",
} as const;

export function DeveloperPortal({
  initialConfig,
  suggestion = null,
  variant = "admin",
  moreHref = "/panel/agente/monitor",
}: {
  initialConfig: OrgAgentConfig;
  suggestion?: FaqSuggestion | null;
  variant?: "admin" | "clinic";
  moreHref?: string;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingFaq, setEditingFaq] = useState<string | null>(null);
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

  function addFaq(question = "", answer = "") {
    const id = crypto.randomUUID();
    patch({ faq: [...config.faq, { id, question, answer }] });
    setEditingFaq(id);
    setDismissedSuggestion(true);
  }

  const health = config.health.preCall;
  const visibleSuggestion = suggestion && !dismissedSuggestion
    && !config.faq.some((item) => item.question === suggestion.question)
    ? suggestion
    : null;

  return (
    <div className={styles.portal}>
      <section className={styles.endpoints}>
        <header>
          <div>
            <h2>Endpoints</h2>
            <p className={styles.toolLead}>API de la clínica · {PROSPER_ENDPOINTS.length} rutas</p>
          </div>
          <div className={styles.endpointHeadActions}>
            <em data-status={health.status}>
              {HEALTH_LABEL[health.status]}
              {health.latencyMs ? ` · ${health.latencyMs} ms` : ""}
            </em>
            <ButtonLink href={moreHref} variant="secondary" size="sm" icon={ArrowRight}>
              Ver más
            </ButtonLink>
          </div>
        </header>
      </section>

      <section className={styles.character}>
        <header>
          <div>
            <h2>{variant === "clinic" ? "Saludo y reglas" : "Prompt y reglas"}</h2>
          </div>
        </header>
        <div className={styles.characterBody}>
          {variant === "admin" ? (
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
          ) : null}
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
              <strong>{variant === "clinic" ? "Reglas de este centro" : "Reglas de este hospital"}</strong>
              <small>Horario, sedes y lo que no debe hacer. Si hay urgencia, pasa a una persona.</small>
            </span>
            <textarea
              rows={4}
              value={config.extraInstructions ?? ""}
              onChange={(event) => patch({ extraInstructions: event.target.value })}
            />
          </label>
          <label>
            <span>
              <strong>Escalar si no avanza</strong>
              <small>Fallos seguidos antes de pasar a una persona. 3 es el valor habitual.</small>
            </span>
            <select
              value={config.escalationFails}
              onChange={(event) => patch({ escalationFails: Number(event.target.value) })}
            >
              <option value={1}>1 intento</option>
              <option value={2}>2 intentos</option>
              <option value={3}>3 intentos</option>
              <option value={4}>4 intentos</option>
            </select>
          </label>
        </div>
      </section>

      <section>
        <div className={styles.faqHead}>
          <div>
            <h2>Preguntas frecuentes</h2>
            <p>Respuestas que el agente usa en las llamadas. Se editan con el lápiz.</p>
          </div>
          <button type="button" onClick={() => addFaq()}>
            Añadir FAQ
          </button>
        </div>
        <div className={styles.suggestions}>
          <div className={styles.suggestionHead}>
            <strong>Sugerencia desde llamadas</strong>
            <small>{visibleSuggestion ? visibleSuggestion.evidence : "Si el mismo tipo de pregunta sale al menos dos veces, aparece aquí en español."}</small>
          </div>
          {visibleSuggestion ? (
            <article>
              <div>
                <span>{visibleSuggestion.count} veces</span>
                <strong>{visibleSuggestion.question}</strong>
                <small>Motivo frecuente que todavía no tiene respuesta arriba.</small>
              </div>
              <nav>
                <button type="button" onClick={() => addFaq(visibleSuggestion.question)}>Añadir</button>
                <button type="button" onClick={() => setDismissedSuggestion(true)}>Descartar</button>
              </nav>
            </article>
          ) : (
            <article>
              <div>
                <strong>Sin sugerencia todavía</strong>
                <small>Hace falta el mismo tipo de pregunta al menos dos veces, y que no esté ya respondida.</small>
              </div>
            </article>
          )}
        </div>
        <div className={styles.faqList}>
          {config.faq.length ? config.faq.map((item, index) => {
            const editing = editingFaq === item.id;
            return (
              <article key={item.id} data-editing={editing}>
                {editing ? (
                  <>
                    <input
                      aria-label="Pregunta"
                      placeholder="¿Cuál es el horario?"
                      value={item.question}
                      autoFocus
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
                  </>
                ) : (
                  <div className={styles.faqCopy}>
                    <strong>{item.question || "Sin pregunta"}</strong>
                    <p>{item.answer || "Sin respuesta todavía."}</p>
                  </div>
                )}
                <div className={styles.faqActions}>
                  <EditButton
                    active={editing}
                    label={item.question || "esta FAQ"}
                    onClick={() => setEditingFaq((current) => (current === item.id ? null : item.id))}
                  />
                  {editing ? (
                    <button
                      type="button"
                      className={styles.faqRemove}
                      onClick={() => {
                        patch({ faq: config.faq.filter((entry) => entry.id !== item.id) });
                        setEditingFaq(null);
                      }}
                    >
                      Eliminar
                    </button>
                  ) : null}
                </div>
              </article>
            );
          }) : <p className={styles.empty}>{variant === "clinic" ? "Todavía no hay preguntas frecuentes en este centro." : "Todavía no hay preguntas frecuentes en este hospital."}</p>}
        </div>
      </section>

      <footer>
        <span>{notice ?? (variant === "clinic"
          ? "Los cambios valen para las próximas llamadas de este centro."
          : "Los cambios de este hospital valen para las próximas llamadas del grupo.")}</span>
        <Button disabled={pending} onClick={() => run(() => saveOrgIntegrationConfig(config))}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </footer>
    </div>
  );
}
