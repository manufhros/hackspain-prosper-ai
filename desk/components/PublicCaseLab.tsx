"use client";

import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { agentAvatarUrl, patientAvatarUrl } from "@/lib/avatars";
import type { SimCase } from "@/lib/cases/types";
import styles from "./PublicCaseLab.module.css";

type ConversationTurn = {
  id: string;
  speaker: "caller" | "agent";
  text: string;
};

type TimelineItem =
  | { id: string; kind: "message"; speaker: "caller" | "agent"; text: string }
  | { id: string; kind: "tool"; name: string };

type AuditItem = {
  id: string;
  name: string;
  params?: Record<string, unknown>;
  result?: string;
};

type LineLog = {
  turns: ConversationTurn[];
  timeline: TimelineItem[];
  audit: AuditItem[];
};

type LineState = {
  id: string;
  scenario: SimCase;
  status: "idle" | "connecting" | "live" | "error";
  lastAgent: string;
};

const TOOL_LABELS: Record<string, string> = {
  search_directory: "Buscar en directorio",
  search_availability: "Buscar huecos",
  list_appointments: "Consultar próximas citas",
  submit_book: "Reservar cita",
  submit_register: "Registrar paciente",
  submit_cancel: "Cancelar cita",
  submit_reschedule: "Cambiar cita",
  submit_no_action: "Cerrar sin acción",
  submit_escalate: "Escalar al equipo humano",
};

const EMPTY_LOG: LineLog = { turns: [], timeline: [], audit: [] };

function PhoneIcon({ hangup = false }: { hangup?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {hangup ? (
        <path d="M5 15.5a12 12 0 0 1 14 0M7.5 14l-2 3M16.5 14l2 3" />
      ) : (
        <path d="M7.2 3.8 10 8 8.3 9.8a14 12 0 0 0 5.9 5.9L16 14l4.2 2.8-.8 3.1a2 2 0 0 1-2 1.5C9.2 20.4 3.6 14.8 2.6 6.6a2 2 0 0 1 1.5-2l3.1-.8Z" />
      )}
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.5 6.5a4 4 0 0 0-5 5L3.8 17.2a2 2 0 0 0 2.8 2.8l5.7-5.7a4 4 0 0 0 5.2-4.8l-2.7 2.7-3-3 2.7-2.7Z" />
    </svg>
  );
}

function parseResult(value?: string) {
  if (!value) return "En curso";
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function pickRandom(cases: SimCase[], count: number, exclude?: string) {
  const pool = cases.filter((item) => item.id !== exclude);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.max(1, count));
}

export function PublicCaseLab({
  scenarios,
  initialId,
}: {
  scenarios: SimCase[];
  initialId: string;
}) {
  const [cases] = useState(scenarios);
  const [scenarioId, setScenarioId] = useState(initialId || cases[0]?.id || "");
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [talkId, setTalkId] = useState("");
  const [lines, setLines] = useState<LineState[]>([]);
  const [logs, setLogs] = useState<Record<string, LineLog>>({});
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selected = cases.find((item) => item.id === scenarioId) ?? cases[0];
  const talkLine = lines.find((line) => line.id === talkId) ?? lines[0];
  const scenario = talkLine?.scenario ?? selected;
  const log = logs[talkId] ?? EMPTY_LOG;
  const timeline = log.timeline;
  const audit = log.audit;
  const liveCount = lines.filter((line) => line.status === "live" || line.status === "connecting").length;

  function patchLine(id: string, next: Partial<LineState>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...next } : line)));
  }

  function patchLog(id: string, updater: (current: LineLog) => LineLog) {
    setLogs((current) => ({ ...current, [id]: updater(current[id] ?? EMPTY_LOG) }));
  }

  function exportJson() {
    download(
      `casos-publicos-turno-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ cases, session: { scenario, transcript: log.turns, audit } }, null, 2),
      "application/json",
    );
  }

  function exportCsv() {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["tipo", "id", "problema", "paciente", "contenido", "resultado"],
      ...cases.map((item) => ["caso_publico", item.id, item.problem_id, item.patient, item.prompt, item.expected]),
      ...log.turns.map((turn) => [
        "transcripcion",
        scenario?.id ?? "",
        scenario?.problem_id ?? "",
        turn.speaker === "caller" ? scenario?.patient : "Marta",
        turn.text,
        turn.speaker,
      ]),
    ];
    download(
      `casos-publicos-turno-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((row) => row.map(quote).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLines((current) => current.map((line) => ({ ...line, status: "idle" })));
    setStatus("idle");
  }

  function randomCase() {
    if (status !== "idle" && status !== "error") return;
    const next = pickRandom(cases, 1, scenarioId)[0];
    if (!next) return;
    setScenarioId(next.id);
    setTalkId("");
    setLines([]);
    setLogs({});
    setError(null);
    setStatus("idle");
  }

  async function consume(id: string, signal: AbortSignal) {
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: id }),
      signal,
    });
    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || response.statusText);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as {
          type: string;
          error?: string;
          turn?: {
            id: string;
            kind: "message" | "tool";
            role?: "agent" | "patient";
            text?: string;
            name?: string;
            input?: Record<string, string>;
            result?: string;
          };
        };
        if (event.type === "error") throw new Error(event.error || "simulation failed");
        if (event.type === "turn" && event.turn) {
          const turn = event.turn;
          if (turn.kind === "message" && turn.text) {
            const speaker = turn.role === "patient" ? "caller" as const : "agent" as const;
            if (speaker === "agent") patchLine(id, { lastAgent: turn.text });
            patchLog(id, (current) => ({
              ...current,
              turns: [...current.turns, { id: turn.id, speaker, text: turn.text! }],
              timeline: [...current.timeline, { id: turn.id, kind: "message", speaker, text: turn.text! }],
            }));
            await sleep(700, signal);
          }
          if (turn.kind === "tool" && turn.name) {
            patchLog(id, (current) => ({
              ...current,
              audit: [...current.audit, { id: turn.id, name: turn.name!, params: turn.input, result: turn.result }],
              timeline: [...current.timeline, { id: turn.id, kind: "tool", name: turn.name! }],
            }));
          }
        }
      }
    }
  }

  async function start(mode: "one" | "three") {
    abortRef.current?.abort();
    const casesToRun = mode === "three"
      ? pickRandom(cases, 3)
      : [selected ?? cases[0]!];
    const first = casesToRun[0];
    if (!first) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setTalkId(first.id);
    setScenarioId(first.id);
    setError(null);
    setLines(casesToRun.map((item) => ({ id: item.id, scenario: item, status: "connecting", lastAgent: "" })));
    setLogs(Object.fromEntries(casesToRun.map((item) => [item.id, { turns: [], timeline: [], audit: [] }])));
    setStatus("live");
    try {
      await Promise.all(casesToRun.map(async (item) => {
        patchLine(item.id, { status: "live" });
        try {
          await consume(item.id, controller.signal);
          if (!controller.signal.aborted) patchLine(item.id, { status: "idle" });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          const message = error instanceof Error ? error.message : "simulation failed";
          setError(message);
          patchLine(item.id, { status: "error" });
        }
      }));
      if (!controller.signal.aborted) setStatus((current) => (current === "live" ? "idle" : current));
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "simulation failed");
        setStatus("error");
      }
    }
  }

  const patientUrl = patientAvatarUrl(scenario?.patient ?? "paciente");
  const agentUrl = agentAvatarUrl();

  return (
    <div className={styles.simulator}>
      <header className={styles.intro}>
        <div>
          <h1>Casos públicos · Guille</h1>
          <p>
            Casos públicos de Prosper. Al descolgar, el AI Gateway interpreta al llamante y a Marta y genera el diálogo;
            cada ejecución sale distinta.
          </p>
        </div>
        <div className={styles.introActions}>
          <div>
            <button type="button" onClick={exportJson}>Exportar todo · JSON</button>
            <button type="button" onClick={exportCsv}>Exportar todo · CSV</button>
          </div>
        </div>
      </header>

      {lines.length > 1 ? (
        <div className={styles.fleet}>
          {lines.map((line) => (
            <button
              type="button"
              key={line.id}
              className={styles.lineCard}
              data-active={line.id === talkId}
              data-status={line.status}
              onClick={() => setTalkId(line.id)}
            >
              <img src={patientAvatarUrl(line.scenario.patient)} alt="" />
              <strong>{line.scenario.patient}</strong>
              <small>{line.scenario.problem_id}</small>
              <em>{line.id === talkId ? "Viendo esta línea" : line.scenario.expected}</em>
              <span>{line.lastAgent || (line.status === "live" ? "En línea" : "Listo")}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.testGrid}>
        <aside className={styles.callerColumn}>
          <section className={styles.caller}>
            <div className={styles.avatarRow}>
              <div className={styles.avatarWrap}>
                {status === "idle" || status === "connecting" ? (
                  <>
                    <span className={styles.incomingRing} />
                    <span className={styles.incomingRing} data-delay />
                  </>
                ) : null}
                <img className={styles.avatar} src={patientUrl} alt="" />
              </div>
              <button
                type="button"
                className={styles.shuffle}
                onClick={randomCase}
                disabled={status !== "idle" && status !== "error"}
                aria-label="Sortear otro caso público"
                title="Otro caso al azar"
              >
                <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
            <h2>{scenario?.patient ?? "Paciente de prueba"}</h2>
            <p>{scenario?.phone ?? "Número oculto"}</p>
            <span data-status={status}>
              {status === "idle"
                ? "Llamada entrante"
                : status === "connecting"
                  ? "Conectando"
                  : status === "live"
                    ? `${liveCount || 1} en simulación`
                    : error ?? "Error"}
            </span>
            {error && status !== "live" ? <p className={styles.callError}>{error}</p> : null}
            <div>
              {status === "idle" || status === "error" ? (
                <>
                  <button type="button" className={styles.answer} onClick={() => void start("one")}><PhoneIcon />Descolgar</button>
                  <button type="button" className={styles.fleetStart} onClick={() => void start("three")}>3 casos al azar</button>
                </>
              ) : (
                <button type="button" className={styles.hangup} onClick={stop}><PhoneIcon hangup />Colgar</button>
              )}
            </div>
          </section>
          <section className={styles.summary}>
            <h2>TL;DR</h2>
            <code>{scenario?.problem_id}</code>
            <p>{scenario?.prompt}</p>
            <span>Esperado: <strong>{scenario?.expected}</strong></span>
            <small>{cases.length} casos públicos. El diálogo lo inventa el LLM a partir del brief, no es un guion fijo.</small>
          </section>
        </aside>

        <section className={styles.conversation}>
          <header>
            <h2>Conversación</h2>
            <p>
              {status === "live"
                ? "El llamante y Marta se van turnando. Cada frase sale del modelo."
                : timeline.length
                  ? "Transcripción de la simulación."
                  : "Contesta para ver la conversación."}
            </p>
          </header>
          <div className={styles.transcript} aria-live="polite">
            {timeline.length ? timeline.map((item) => item.kind === "tool" ? (
              <div className={styles.toolLine} key={item.id}>
                <i />
                <span><ToolIcon /> Consulta al sistema: {TOOL_LABELS[item.name] ?? item.name}</span>
                <i />
              </div>
            ) : (
              <article key={item.id} data-speaker={item.speaker}>
                <img
                  className={styles.messageAvatar}
                  src={item.speaker === "caller" ? patientUrl : agentUrl}
                  alt=""
                />
                <div className={styles.messageContent}>
                  <span>{item.speaker === "caller" ? scenario?.patient : "Marta"}</span>
                  <p>{item.text}</p>
                </div>
              </article>
            )) : <div className={styles.empty}>{status === "idle" ? "No hay llamada en curso." : "Aún no hay frases."}</div>}
          </div>
        </section>

        <section className={styles.audit}>
          <header><h2>Auditoría</h2><p>Herramientas de la línea seleccionada.</p></header>
          <div>
            {audit.length ? audit.map((item, index) => (
              <details key={item.id}>
                <summary><span>{index + 1}</span><ToolIcon /><strong>{TOOL_LABELS[item.name] ?? item.name}</strong></summary>
                <pre>{JSON.stringify({ consulta: item.params, resultado: parseResult(item.result) }, null, 2)}</pre>
              </details>
            )) : <div className={styles.empty}>Aquí verás cada consulta al ERP cuando empiece la llamada.</div>}
          </div>
        </section>
      </div>
      <footer className={styles.callHint}>
        Cada descolgar vuelve a sortear el diálogo. Los datos del paciente salen del JSON público de Prosper.
      </footer>
    </div>
  );
}
