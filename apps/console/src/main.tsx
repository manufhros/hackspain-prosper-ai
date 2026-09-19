import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  DomainEvent,
  Delivery,
} from "../../../packages/contracts/src/index.js";
import "./style.css";
import { BrowserVoice } from "./browser-voice.js";
function App() {
  const voice = useRef<BrowserVoice | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Micrófono desconectado");
  useEffect(() => () => voice.current?.stop(), []);
  const [token, setToken] = useState("");
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [active, setActive] = useState<string[]>([]);
  const [selected, select] = useState("");
  const [config, setConfig] = useState<{
    engine: string;
    clinic: string;
    store: string;
    simulation: boolean;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  async function api(path: string, body?: unknown) {
    const r = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!r.ok)
      throw new Error(
        r.status === 401
          ? "Introduce el token de consola."
          : `La operación falló (${r.status}).`,
      );
    return r.json();
  }
  async function refresh() {
    const [c, e] = await Promise.all([api("config"), api("events")]);
    setConfig(c);
    setEvents(e.events);
    setDeliveries(e.deliveries);
    setActive(e.active);
  }
  useEffect(() => {
    let live = true;
    const tick = () => {
      if (live)
        void refresh().catch((e) => {
          if (live) setError(e.message);
        });
    };
    tick();
    const timer = setInterval(tick, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [token]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startVoice() {
    setError("");
    setVoiceActive(true);
    setVoiceStatus("Solicitando acceso al micrófono…");
    const session = new BrowserVoice(
      (status) => {
        setVoiceStatus(status);
        if (status === "Micrófono desconectado") setVoiceActive(false);
      },
      select,
      setError,
    );
    voice.current = session;
    try {
      await session.start(() => api("voice-ticket", {}));
    } catch (e) {
      setError((e as Error).message);
      setVoiceActive(false);
    }
  }
  const ids = [
    ...new Set([...active, ...events.map((e) => e.callId)]),
  ].reverse();
  const log = events.filter((e) => e.callId === selected);
  const receipt = deliveries.filter((d) => d.callId === selected);
  const live = active.includes(selected);
  const send = async (text: string) => {
    await api(`calls/${selected}/text`, { text });
  };
  async function demo() {
    const { callId } = await api("calls", {});
    select(callId);
    const date = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", {
      timeZone: "Europe/Madrid",
    });
    for (const text of [
      "/tool create_task {}",
      '/tool verify_patient {"task_id":"$task","national_id":"12345678Z","date_of_birth":"1988-03-14"}',
      `/tool set_request {"task_id":"$task","request":{"date_from":"${date}","date_to":"${date}","specialty_id":"general_practice"}}`,
      '/tool find_slots {"task_id":"$task"}',
      '/tool propose_booking {"task_id":"$task","slot_index":0,"policy_id":"sanitas"}',
    ])
      await api(`calls/${callId}/text`, { text });
  }
  return (
    <div className="layout">
      <aside>
        <a className="brand" href="/">
          a<span>arenal</span>
        </a>
        <div className="eyebrow">VOICE AGENT LAB</div>
        <h2>Llamadas</h2>
        <button
          className="primary"
          disabled={busy || !config?.simulation}
          onClick={() =>
            run(async () => {
              const r = await api("calls", {});
              select(r.callId);
            })
          }
        >
          + Nueva sesión
        </button>
        <nav>
          {ids.map((id) => (
            <button
              key={id}
              className={id === selected ? "selected" : ""}
              onClick={() => select(id)}
            >
              <span className={active.includes(id) ? "dot live" : "dot"} />
              <span>
                {id.slice(0, 8)}
                <small>{active.includes(id) ? "En curso" : "Finalizada"}</small>
              </span>
            </button>
          ))}
        </nav>
        <label className="token">
          Token de consola
          <input
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError("");
            }}
            placeholder="Solo si está configurado"
            autoComplete="off"
          />
        </label>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">HACKSPAIN / PROSPER</div>
            <h1>
              Una conversación.
              <br />
              <span>Un sistema detrás.</span>
            </h1>
          </div>
          <span className="badge">
            {config?.simulation ? "Datos sintéticos" : "Prosper"} ·{" "}
            {config?.engine ?? "Conectando"}
          </span>
        </header>
        <section className="stats">
          <article>
            <small>Motor de conversación</small>
            <strong>{config?.engine ?? "—"}</strong>
          </article>
          <article>
            <small>Fuente clínica</small>
            <strong>{config?.clinic ?? "—"}</strong>
          </article>
          <article>
            <small>Persistencia</small>
            <strong>{config?.store ?? "—"}</strong>
          </article>
          <article>
            <small>Sesiones activas</small>
            <strong>{active.length}</strong>
          </article>
        </section>
        <section className="voice-panel">
          <div>
            <h2>Habla con el agente</h2>
            <p>
              Prueba con tu micrófono. Datos ficticios; las acciones no se
              envían a Prosper.
            </p>
            <small>
              Paciente de prueba: Ana García López · DNI 12345678Z · nacimiento
              14/03/1988 · Sanitas
            </small>
            <p role="status">{voiceStatus}</p>
          </div>
          <button
            className="primary"
            disabled={!voiceActive && (!config || config.engine === "text")}
            onClick={() => {
              if (voiceActive) {
                voice.current?.stop();
              } else void startVoice();
            }}
          >
            {voiceActive ? "Finalizar prueba de voz" : "Hablar con el agente"}
          </button>
        </section>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {!selected ? (
          <section className="welcome">
            <div className="eyebrow">PRIMER RECORRIDO</div>
            <h2>De la identificación a la confirmación.</h2>
            <p>
              Explora una reserva con datos sintéticos. Verás las herramientas,
              la propuesta y el recibo de entrega de la aplicación.
            </p>
            <button
              className="primary"
              disabled={busy || config?.engine !== "text" || !config.simulation}
              onClick={() => run(demo)}
            >
              Preparar reserva de ejemplo ↗
            </button>
            <p className="muted">
              El modo text usa comandos explícitos. No es un modelo de lenguaje.
            </p>
          </section>
        ) : (
          <div className="panels">
            <section className="conversation">
              <div className="section-head">
                <h2>Conversación</h2>
                <span>{selected.slice(0, 8)}</span>
              </div>
              <div className="messages">
                {log
                  .filter(
                    (e) =>
                      e.type === "assistant.text" || e.type === "user.text",
                  )
                  .map((e) => (
                    <div
                      key={e.id}
                      className={
                        "message " +
                        (e.type === "user.text" ? "user" : "assistant")
                      }
                    >
                      <small>
                        {e.type === "user.text" ? "INTERLOCUTOR" : "AGENTE"}
                      </small>
                      <p>{String((e.data as { text: string }).text)}</p>
                    </div>
                  ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await send(input);
                    setInput("");
                  });
                }}
              >
                <input
                  aria-label="Mensaje"
                  disabled={!live || busy}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    config?.engine === "text"
                      ? "/tool nombre {argumentos} o «sí»"
                      : "Escribe un mensaje…"
                  }
                />
                <button disabled={!live || busy || !input.trim()}>
                  Enviar
                </button>
              </form>
              <button
                className="finish"
                disabled={!live || busy}
                onClick={() =>
                  run(async () => {
                    if (selected.startsWith("browser-")) voice.current?.stop();
                    else await api(`calls/${selected}/close`, {});
                  })
                }
              >
                Finalizar llamada y entregar acciones confirmadas
              </button>
            </section>
            <section className="trace">
              <div className="section-head">
                <h2>Actividad</h2>
                <span>{log.length} eventos</span>
              </div>
              <div className="timeline">
                {log
                  .filter((e) => !e.type.endsWith(".text"))
                  .map((e) => (
                    <details key={e.id}>
                      <summary>
                        <time>{new Date(e.at).toLocaleTimeString("es")}</time>
                        {e.type}
                      </summary>
                      <pre>{JSON.stringify(e.data, null, 2)}</pre>
                    </details>
                  ))}
              </div>
              <h3>Entrega</h3>
              {receipt.length ? (
                receipt.map((d) => (
                  <article className="receipt" key={d.id}>
                    <b>{d.action.action}</b>
                    <span>{d.status}</span>
                    <small>{d.attempts} intento(s)</small>
                  </article>
                ))
              ) : (
                <p className="muted">Todavía no hay acciones entregadas.</p>
              )}
              <p className="muted">
                «accepted» confirma recepción. No es una puntuación del
                evaluador.
              </p>
            </section>
          </div>
        )}
        <footer>
          Motor intercambiable · Estado por llamada · Validaciones compartidas
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
