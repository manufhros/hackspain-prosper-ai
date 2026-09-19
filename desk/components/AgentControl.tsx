"use client";

import {
  publishAgentDraft,
  rollbackAgentConfig,
  saveAgentDraft,
} from "@/app/panel/agente/agent-config-actions";
import type { AgentConfig, AgentConfigState } from "@/lib/agent-config";
import { useState, useTransition } from "react";
import styles from "./AgentControl.module.css";

function Toggle({
  label,
  copy,
  checked,
  onChange,
}: {
  label: string;
  copy: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.row}>
      <span><strong>{label}</strong><small>{copy}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function AgentControl({ initialState }: { initialState: AgentConfigState }) {
  const [state, setState] = useState(initialState);
  const [draft, setDraft] = useState<AgentConfig>(initialState.draft);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(next: Partial<AgentConfig>) {
    setDraft((current) => ({ ...current, ...next }));
    setNotice(null);
  }

  function run(action: () => Promise<{ ok: boolean; message: string; state?: AgentConfigState }>) {
    startTransition(async () => {
      const result = await action();
      setNotice(result.message);
      if (result.state) {
        setState(result.state);
        setDraft(result.state.draft);
      }
    });
  }

  return (
    <div className={styles.control}>
      <header>
        <h3>Comportamiento</h3>
        <span>{state.active ? "Publicado" : "Borrador"}</span>
      </header>
      <div className={styles.voice}>
        <label>
          <span><strong>Voz de recepción</strong><small>Nativa de España · cálida y profesional</small></span>
          <select value={draft.voiceId} onChange={(event) => update({ voiceId: event.target.value })}>
            <option value="UOIqAnmS11Reiei1Ytkc">Carolina · español peninsular</option>
          </select>
        </label>
        <label>
          <span><strong>Velocidad</strong><small>{draft.voiceSpeed.toFixed(2).replace(".", ",")}×</small></span>
          <input
            type="range"
            min="0.8"
            max="1.1"
            step="0.01"
            value={draft.voiceSpeed}
            onChange={(event) => update({ voiceSpeed: Number(event.target.value) })}
          />
        </label>
      </div>
      <Toggle
        label="Ambiente de recepción"
        copy={`Oficina muy suave · volumen ${Math.round(draft.backgroundVolume * 100)} %`}
        checked={draft.backgroundEnabled}
        onChange={(value) => update({ backgroundEnabled: value })}
      />
      <Toggle
        label="Teclado al consultar"
        copy="Solo mientras busca paciente, agenda o citas."
        checked={draft.typingEnabled}
        onChange={(value) => update({ typingEnabled: value })}
      />
      <Toggle
        label="Buscar paciente antes de hablar"
        copy="Consulta la ficha con el número entrante."
        checked={draft.patientLookup}
        onChange={(value) => update({ patientLookup: value })}
      />
      <Toggle
        label="Inyectar contexto dinámico"
        copy="Nombre, póliza y última visita."
        checked={draft.dynamicContext}
        onChange={(value) => update({ dynamicContext: value })}
      />
      <Toggle
        label="Herramientas de agenda"
        copy="Reservar, mover, cancelar y registrar."
        checked={draft.actionTools}
        onChange={(value) => update({ actionTools: value })}
      />
      <Toggle
        label="Webhook postllamada"
        copy="Envía resultado y resumen al centro."
        checked={draft.postCallWebhook}
        onChange={(value) => update({ postCallWebhook: value })}
      />
      <Toggle
        label="Redactar datos en auditoría"
        copy="Oculta datos personales en la auditoría y omite el texto en transferencias. La transcripción se guarda en Llamadas."
        checked={draft.zeroRetention}
        onChange={(value) => update({ zeroRetention: value })}
      />
      <Toggle
        label="Región UE"
        copy="Procesado y registros dentro de Europa."
        checked={draft.euOnly}
        onChange={(value) => update({ euOnly: value })}
      />
      <label className={styles.selectRow}>
        <span><strong>Escalar tras fallos</strong><small>Intentos antes de pasar a una persona.</small></span>
        <select
          value={draft.escalationFails}
          onChange={(event) => update({ escalationFails: Number(event.target.value) })}
        >
          <option value={1}>1 intento</option>
          <option value={2}>2 intentos</option>
          <option value={3}>3 intentos</option>
          <option value={4}>4 intentos</option>
        </select>
      </label>
      <label className={styles.selectRow}>
        <span><strong>Enrutado</strong><small>Observa primero; aplica después de validarlo.</small></span>
        <select
          value={draft.routingMode}
          onChange={(event) => update({ routingMode: event.target.value as AgentConfig["routingMode"] })}
        >
          <option value="shadow">Observación</option>
          <option value="enforce">Activo</option>
        </select>
      </label>
      <label className={styles.selectRow}>
        <span><strong>Umbral de frustración</strong><small>Al alcanzarlo, ofrece pasar al equipo humano.</small></span>
        <b className={styles.threshold}>{draft.frustrationThreshold}/100</b>
        <input
          type="range"
          min="50"
          max="100"
          value={draft.frustrationThreshold}
          onChange={(event) => update({ frustrationThreshold: Number(event.target.value) })}
        />
      </label>
      <div className={styles.faq}>
        <div>
          <h3>Preguntas frecuentes</h3>
          <p>Contenido aprobado para toda la red. No se configura por hospital.</p>
          <button
            type="button"
            onClick={() => update({
              faq: [...draft.faq, { id: crypto.randomUUID(), question: "", answer: "" }],
            })}
          >
            Añadir FAQ
          </button>
        </div>
        {draft.faq.length ? draft.faq.map((item, index) => (
          <article key={item.id}>
            <input
              aria-label="Pregunta"
              placeholder="¿Cuál es el horario?"
              value={item.question}
              onChange={(event) => {
                const faq = [...draft.faq];
                faq[index] = { ...item, question: event.target.value };
                update({ faq });
              }}
            />
            <textarea
              aria-label="Respuesta"
              placeholder="Centro abre de lunes a sábado…"
              value={item.answer}
              onChange={(event) => {
                const faq = [...draft.faq];
                faq[index] = { ...item, answer: event.target.value };
                update({ faq });
              }}
            />
            <button type="button" onClick={() => update({ faq: draft.faq.filter((entry) => entry.id !== item.id) })}>
              Eliminar
            </button>
          </article>
        )) : <p className={styles.note}>Todavía no hay preguntas frecuentes publicadas.</p>}
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={isPending} onClick={() => run(() => saveAgentDraft(draft))}>
          Guardar borrador
        </button>
        <button type="button" disabled={isPending} onClick={() => run(() => publishAgentDraft(draft))}>
          {isPending ? "Aplicando…" : "Publicar"}
        </button>
      </div>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {state.active ? (
        <div className={styles.version}>
          <span>Activa desde {new Date(state.active.publishedAt).toLocaleString("es-ES")}</span>
          {state.versions[1] ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => rollbackAgentConfig(state.versions[1]!.id))}
            >
              Restaurar anterior
            </button>
          ) : null}
        </div>
      ) : (
        <p className={styles.note}>Aún no hay una versión publicada desde esta consola.</p>
      )}
    </div>
  );
}
