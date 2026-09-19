"use client";

import { useRef, useState } from "react";
import styles from "./VoiceSimulator.module.css";

type Scenario = {
  id: string;
  title: string;
  prompt: string;
  expected: string;
  patient: string;
  phone: string;
  started: string | null;
  site: string;
  orgSlug?: string;
  script?: string[];
  actions: Array<{ name: string; at: string | null; reason: string | null; summary: string }>;
};

type ConversationTurn = {
  id: string;
  speaker: "caller" | "agent";
  text: string;
  language?: string;
};

type TimelineItem =
  | { id: string; kind: "message"; speaker: "caller" | "agent"; text: string; language?: string }
  | { id: string; kind: "tool"; name: string };

type AuditItem = {
  id: string;
  name: string;
  params?: Record<string, unknown>;
  result?: string;
};

type LineId = string;

type LineState = {
  id: LineId;
  scenario: Scenario;
  status: "idle" | "connecting" | "live" | "error";
  lastAgent: string;
};

type LineLog = {
  turns: ConversationTurn[];
  timeline: TimelineItem[];
  audit: AuditItem[];
};

function PhoneIcon({ hangup = false }: { hangup?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {hangup ? (
        <path d="M5 15.5a12 12 0 0 1 14 0M7.5 14l-2 3M16.5 14l2 3" />
      ) : (
        <path d="M7.2 3.8 10 8 8.3 9.8a14 14 0 0 0 5.9 5.9L16 14l4.2 2.8-.8 3.1a2 2 0 0 1-2 1.5C9.2 20.4 3.6 14.8 2.6 6.6a2 2 0 0 1 1.5-2l3.1-.8Z" />
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

function linearToUlaw(sample: number) {
  const BIAS = 0x84;
  let pcm = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  pcm = Math.min(32635, pcm) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(pcm & mask); exponent--, mask >>= 1);
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function ulawToLinear(value: number) {
  const byte = ~value & 0xff;
  const sign = byte & 0x80;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  const sample = ((mantissa << 3) + 0x84) << exponent;
  return (sign ? 0x84 - sample : sample - 0x84) / 32768;
}

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

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
  handoff_context: "Contexto entregado al equipo humano",
};

const EMPTY_LOG: LineLog = { turns: [], timeline: [], audit: [] };

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

function rms(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
  return Math.sqrt(sum / samples.length);
}

function ulawIsAudible(bytes: Uint8Array) {
  let loud = 0;
  for (const value of bytes) {
    if ((~value & 0x7f) > 8) loud += 1;
  }
  return loud > bytes.length * 0.04;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
}

function fleetCases(): Scenario[] {
  return [
    {
      id: "live-talk-quiron",
      title: "1 · Transferencia",
      prompt: "Caso de prueba: habla tú y pide una persona. El agente escala y Twilio te llama.",
      expected: "submit_escalate + llamada a tu móvil",
      patient: "Tú",
      phone: "+34687275510",
      started: null,
      site: "Clínica Quirón",
      orgSlug: "quironsalud",
      script: ["Quiero hablar con una persona, páseme con recepción."],
      actions: [],
    },
    {
      id: "live-book-arenal",
      title: "2 · Primera cita",
      prompt: "Caso de prueba: paciente conocido pide la primera cita de medicina general.",
      expected: "search_directory → search_availability",
      patient: "Paciente Arenal",
      phone: "+34711330529",
      started: null,
      site: "Clínica Arenal",
      orgSlug: "arenal",
      script: [
        "Hola, quiero la primera cita de medicina general, lo antes posible.",
        "Sí, soy yo.",
        "Sí, esa hora me viene bien.",
      ],
      actions: [],
    },
    {
      id: "live-faq-sanitas",
      title: "3 · Horario sábado",
      prompt: "Caso de prueba: pregunta si abren los sábados. No debe transferir.",
      expected: "FAQ: solo Centro abre sábado",
      patient: "Elena Vidal",
      phone: "+34611926767",
      started: null,
      site: "Clínica Sanitas",
      orgSlug: "sanitas",
      script: ["Buenos días, ¿abrís los sábados?"],
      actions: [],
    },
  ];
}

export function VoiceSimulator({
  scenarios,
  endpoint,
  orgSlug = "arenal",
}: {
  scenarios: Scenario[];
  endpoint: string;
  orgSlug?: string;
}) {
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [talkId, setTalkId] = useState<LineId>("");
  const [lines, setLines] = useState<LineState[]>([]);
  const [logs, setLogs] = useState<Record<LineId, LineLog>>({});
  const socketsRef = useRef<Record<LineId, { ws: WebSocket; streamSid: string }>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const talkIdRef = useRef("");
  const contextRef = useRef<AudioContext | null>(null);
  const playbackAt = useRef(0);
  const lastVoiceAt = useRef(0);

  const selected = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
  const talkLine = lines.find((line) => line.id === talkId) ?? lines[0];
  const scenario = talkLine?.scenario ?? selected;
  const log = logs[talkId] ?? EMPTY_LOG;
  const turns = log.turns;
  const timeline = log.timeline;
  const audit = log.audit;
  const liveCount = lines.filter((line) => line.status === "live" || line.status === "connecting").length;

  function selectTalk(id: LineId) {
    talkIdRef.current = id;
    setTalkId(id);
  }

  function patchLine(id: LineId, next: Partial<LineState>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...next } : line)));
  }

  function patchLog(id: LineId, updater: (current: LineLog) => LineLog) {
    setLogs((current) => ({ ...current, [id]: updater(current[id] ?? EMPTY_LOG) }));
  }

  function exportJson() {
    const liveSession = {
      scenario,
      status,
      transcript: turns,
      audit,
      exportedAt: new Date().toISOString(),
    };
    download(
      `exportacion-completa-hash-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ savedCalls: scenarios, liveSession }, null, 2),
      "application/json",
    );
  }

  function exportCsv() {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["tipo", "id", "fecha", "paciente_o_actor", "centro", "contenido", "resultado", "detalle"],
      ...scenarios.map((item) => [
        "llamada_guardada",
        item.id,
        item.started,
        item.patient,
        item.site,
        item.prompt,
        item.expected,
        item.actions.map((action) => action.name).join(" | "),
      ]),
      ...turns.map((turn) => [
        "transcripcion_actual",
        scenario?.id ?? "",
        new Date().toISOString(),
        turn.speaker === "caller" ? scenario?.patient : "Agente",
        scenario?.site ?? "",
        turn.text,
        "",
        turn.speaker,
      ]),
      ...audit.map((item) => [
        "accion_actual",
        scenario?.id ?? "",
        new Date().toISOString(),
        "Agente",
        scenario?.site ?? "",
        TOOL_LABELS[item.name] ?? item.name,
        item.result ?? "En curso",
        JSON.stringify(item.params ?? {}),
      ]),
    ];
    download(
      `exportacion-completa-hash-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((row) => row.map(quote).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  function stop() {
    for (const line of Object.values(socketsRef.current)) {
      if (line.ws.readyState === WebSocket.OPEN) line.ws.send(JSON.stringify({ event: "stop" }));
      line.ws.close();
    }
    socketsRef.current = {};
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    talkIdRef.current = "";
    lastVoiceAt.current = 0;
    setTalkId("");
    setLines([]);
    setStatus("idle");
  }

  async function start(mode: "one" | "three") {
    try {
      stop();
      const cases = mode === "three" ? fleetCases() : [selected ?? fleetCases()[0]!];
      const firstId = cases[0]!.id;
      talkIdRef.current = firstId;
      setTalkId(firstId);
      setLines(cases.map((item) => ({ id: item.id, scenario: item, status: "connecting", lastAgent: "" })));
      setLogs(Object.fromEntries(cases.map((item) => [item.id, { turns: [], timeline: [], audit: [] }])));
      setStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silent = context.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const active = socketsRef.current[talkIdRef.current];
        if (!active || active.ws.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        const now = performance.now();
        if (rms(input) >= 0.028) lastVoiceAt.current = now;
        if (now - lastVoiceAt.current > 280) return;
        const ratio = context.sampleRate / 8000;
        const length = Math.floor(input.length / ratio);
        const encoded = new Uint8Array(length);
        for (let i = 0; i < length; i++) encoded[i] = linearToUlaw(input[Math.floor(i * ratio)] ?? 0);
        active.ws.send(JSON.stringify({
          event: "media",
          streamSid: active.streamSid,
          media: { payload: bytesToBase64(encoded) },
        }));
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);

      cases.forEach((item, lineIndex) => {
        const ws = new WebSocket(endpoint);
        const streamSid = crypto.randomUUID();
        const callSid = crypto.randomUUID();
        socketsRef.current[item.id] = { ws, streamSid };
        ws.onopen = () => {
          ws.send(JSON.stringify({
            event: "start",
            start: {
              streamSid,
              callSid,
              customParameters: {
                call_id: callSid,
                from_number: item.phone.replaceAll(" ", "") || "+34600000000",
                org_slug: item.orgSlug ?? orgSlug,
                simulation: item.id,
              },
            },
          }));
          patchLine(item.id, { status: "live" });
          setStatus("live");
          if (lineIndex === 0) return;
          item.script?.forEach((text, index) => {
            window.setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ event: "user_text", text }));
              }
            }, 5000 + (lineIndex - 1) * 1600 + index * 8000);
          });
        };
        ws.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as {
            event?: string;
            media?: { payload?: string };
            monitor?: {
              type?: string;
              text?: string;
              language?: string;
              name?: string;
              params?: Record<string, unknown>;
              result?: string;
              reason?: string;
              fromNumber?: string | null;
              patient?: Record<string, unknown>;
              intent?: string | null;
              frustrationScore?: number;
              transcript?: Array<{ speaker: string; text: string }>;
            };
          };
          if (message.event === "monitor" && message.monitor) {
            const monitor = message.monitor;
            if ((monitor.type === "user" || monitor.type === "agent") && monitor.text) {
              const turn = {
                id: crypto.randomUUID(),
                speaker: monitor.type === "user" ? "caller" as const : "agent" as const,
                text: monitor.text,
                language: monitor.language,
              };
              if (turn.speaker === "agent") patchLine(item.id, { lastAgent: turn.text });
              patchLog(item.id, (current) => ({
                ...current,
                turns: [...current.turns, turn],
                timeline: [...current.timeline, { ...turn, kind: "message" }],
              }));
            }
            if (monitor.type === "tool" && monitor.name) {
              const id = crypto.randomUUID();
              patchLog(item.id, (current) => ({
                ...current,
                audit: [...current.audit, { id, name: monitor.name!, params: monitor.params }],
                timeline: [...current.timeline, { id: `timeline-${id}`, kind: "tool", name: monitor.name! }],
              }));
            }
            if (monitor.type === "tool_result" && monitor.name) {
              patchLog(item.id, (current) => {
                const next = [...current.audit];
                const index = next.findLastIndex((entry) => entry.name === monitor.name && !entry.result);
                if (index >= 0) next[index] = { ...next[index]!, result: monitor.result };
                return { ...current, audit: next };
              });
            }
            if (monitor.type === "handoff") {
              const id = crypto.randomUUID();
              patchLog(item.id, (current) => ({
                ...current,
                audit: [...current.audit, {
                  id,
                  name: "handoff_context",
                  params: {
                    reason: monitor.reason,
                    fromNumber: monitor.fromNumber,
                    patient: monitor.patient,
                    intent: monitor.intent,
                    frustrationScore: monitor.frustrationScore,
                    transcript: monitor.transcript,
                  },
                  result: JSON.stringify({ preparado: true }),
                }],
                timeline: [...current.timeline, { id: `timeline-${id}`, kind: "tool", name: "handoff_context" }],
              }));
            }
            return;
          }
          if (message.event === "media" && message.media?.payload && item.id === talkIdRef.current) {
            const bytes = base64ToBytes(message.media.payload);
            if (!ulawIsAudible(bytes)) return;
            const buffer = context.createBuffer(1, bytes.length, 8000);
            const channel = buffer.getChannelData(0);
            bytes.forEach((byte, index) => { channel[index] = ulawToLinear(byte); });
            const playback = context.createBufferSource();
            playback.buffer = buffer;
            playback.connect(context.destination);
            playbackAt.current = Math.max(context.currentTime, playbackAt.current);
            playback.start(playbackAt.current);
            playbackAt.current += buffer.duration;
          }
        };
        ws.onerror = () => patchLine(item.id, { status: "error" });
        ws.onclose = () => {
          patchLine(item.id, { status: "idle" });
          delete socketsRef.current[item.id];
          if (!Object.keys(socketsRef.current).length) setStatus("idle");
        };
      });
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className={styles.simulator}>
      <header className={styles.intro}>
        <div>
          <h1>Pruebas</h1>
          <p>Tres llamadas a la vez: tú hablas en la primera, las otras dos siguen su caso solas. El micro está abierto; el silencio no se envía.</p>
        </div>
        <div className={styles.introActions}>
          <div>
            <button type="button" onClick={exportJson}>Exportar todo · JSON</button>
            <button type="button" onClick={exportCsv}>Exportar todo · CSV</button>
          </div>
        </div>
      </header>

      <div className={styles.controls}>
        <label>
          <span>Endpoint Twilio /ws</span>
          <input value={endpoint} readOnly />
        </label>
        <label>
          <span>Caso individual</span>
          <select value={scenarioId} disabled={status !== "idle"} onChange={(event) => setScenarioId(event.target.value)}>
            {scenarios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
      </div>

      {lines.length > 1 ? (
        <div className={styles.fleet}>
          {lines.map((line) => (
            <button
              type="button"
              key={line.id}
              className={styles.lineCard}
              data-active={line.id === talkId}
              data-status={line.status}
              onClick={() => selectTalk(line.id)}
            >
              <b aria-hidden="true">{initials(line.scenario.patient)}</b>
              <strong>{line.scenario.title}</strong>
              <small>{line.scenario.patient} · {line.scenario.site}</small>
              <em>{line.id === talkId ? "Tú hablas aquí" : line.scenario.expected}</em>
              <span>{line.lastAgent || line.scenario.script?.[0] || (line.status === "live" ? "En línea" : "Conectando")}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.testGrid}>
        <aside className={styles.callerColumn}>
          <section className={styles.caller}>
            <div className={styles.avatar} aria-hidden="true">
              {initials(scenario?.patient ?? "P")}
            </div>
            <h2>{scenario?.patient ?? "Paciente de prueba"}</h2>
            <p>{scenario?.phone ?? "Número oculto"}</p>
            <span data-status={status}>
              {status === "idle" ? "Llamada entrante" : status === "connecting" ? "Conectando" : status === "live" ? `${liveCount} en línea` : "Error"}
            </span>
            <div>
              {status === "idle" || status === "error" ? (
                <>
                  <button className={styles.answer} onClick={() => start("one")}><PhoneIcon />Contestar una</button>
                  <button className={styles.fleetStart} onClick={() => start("three")}>3 llamadas a la vez</button>
                </>
              ) : (
                <button className={styles.hangup} onClick={stop}><PhoneIcon hangup />Colgar todas</button>
              )}
            </div>
          </section>
          <section className={styles.summary}>
            <h2>TL;DR</h2>
            <code>{scenario?.id.slice(0, 24)}</code>
            <p>{scenario?.prompt}</p>
            <span>Esperado: <strong>{scenario?.expected}</strong></span>
            <small>{scenarios.length} llamadas guardadas disponibles para repetir o exportar.</small>
          </section>
        </aside>

        <section className={styles.conversation}>
          <header><h2>Conversación</h2><p>{status === "live" ? (lines.length > 1 ? "Habla en la tarjeta seleccionada. Las otras dos siguen su guion." : "Transcripción en directo. Habla y aparecerá aquí.") : turns.length ? "Transcripción conservada tras la llamada." : "Contesta una línea o lanza las tres pruebas a la vez."}</p></header>
          <div className={styles.transcript} aria-live="polite">
            {timeline.length ? timeline.map((item) => item.kind === "tool" ? (
              <div className={styles.toolLine} key={item.id}>
                <i />
                <span><ToolIcon /> Consulta al sistema: {TOOL_LABELS[item.name] ?? item.name}</span>
                <i />
              </div>
            ) : (
              <article key={item.id} data-speaker={item.speaker}>
                <div className={styles.messageAvatar} aria-hidden="true">
                  {item.speaker === "caller" ? initials(scenario?.patient ?? "P") : "h"}
                </div>
                <div className={styles.messageContent}>
                  <span>
                    {item.speaker === "caller" ? scenario?.patient : "Agente"}
                    {item.language ? <em>{item.language.toUpperCase()}</em> : null}
                  </span>
                  <p>{item.text}</p>
                </div>
              </article>
            )) : <div className={styles.empty}>Aún no hay frases.</div>}
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
            )) : <div className={styles.empty}>Todavía no ha consultado el sistema.</div>}
          </div>
        </section>
      </div>
      <footer className={styles.callHint}>
        Usa auriculares. El micro de la tarjeta seleccionada está abierto; no se manda el ruido de fondo.
      </footer>
    </div>
  );
}
