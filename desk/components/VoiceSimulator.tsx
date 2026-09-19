"use client";

import { useRef, useState } from "react";
import { agentAvatarUrl, patientAvatarUrl } from "@/lib/avatars";
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
  speaker: "caller" | "agent" | "helper";
  text: string;
  language?: string;
};

type TimelineItem =
  | { id: string; kind: "message"; speaker: "caller" | "agent" | "helper"; text: string; language?: string }
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

function fleetCases(handoffNumber: string): Scenario[] {
  return [
    {
      id: "live-talk-arenal",
      title: "1 · Transferencia",
      prompt: "Pide una persona. Al descolgar, el paciente de prueba pide cita; tú solo dices que sí, que se la coges.",
      expected: "submit_escalate + tú en el móvil como recepción",
      patient: "Tú",
      phone: handoffNumber || "+34600000000",
      started: null,
      site: "Clínica Arenal",
      orgSlug: "arenal",
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
      id: "live-faq-arenal",
      title: "3 · Horario sábado",
      prompt: "Caso de prueba: pregunta si abren los sábados. No debe transferir.",
      expected: "FAQ: solo Centro abre sábado",
      patient: "Elena Vidal",
      phone: "+34611926767",
      started: null,
      site: "Clínica Arenal",
      orgSlug: "arenal",
      script: ["Buenos días, ¿abrís los sábados?"],
      actions: [],
    },
  ];
}

export function VoiceSimulator({
  scenarios,
  endpoint,
  orgSlug = "arenal",
  handoffNumber = "",
}: {
  scenarios: Scenario[];
  endpoint: string;
  orgSlug?: string;
  /** Number Twilio dials for the human-handoff test case (VOICE_TEST_PHONE). */
  handoffNumber?: string;
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
  const micLiveRef = useRef(false);
  const helperRef = useRef(false);
  const [micLive, setMicLive] = useState(false);
  const [helperOnPhone, setHelperOnPhone] = useState(false);

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
    playbackAt.current = 0;
    talkIdRef.current = "";
    lastVoiceAt.current = 0;
    micLiveRef.current = false;
    helperRef.current = false;
    setMicLive(false);
    setHelperOnPhone(false);
    setTalkId("");
    setLines([]);
    setStatus("idle");
  }

  async function start(mode: "one" | "three") {
    try {
      stop();
      const cases = mode === "three" ? fleetCases(handoffNumber) : [selected ?? fleetCases(handoffNumber)[0]!];
      const firstId = cases[0]!.id;
      talkIdRef.current = firstId;
      setTalkId(firstId);
      setLines(cases.map((item) => ({ id: item.id, scenario: item, status: "connecting", lastAgent: "" })));
      setLogs(Object.fromEntries(cases.map((item) => [item.id, { turns: [], timeline: [], audit: [] }])));
      setStatus("connecting");
      helperRef.current = false;
      setHelperOnPhone(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      playbackAt.current = 0;
      await context.resume();
      const unlock = context.createBufferSource();
      unlock.buffer = context.createBuffer(1, 1, context.sampleRate);
      unlock.connect(context.destination);
      unlock.start();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2048, 1, 1);
      const silent = context.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const active = socketsRef.current[talkIdRef.current];
        if (!active || active.ws.readyState !== WebSocket.OPEN) return;
        if (context.state === "suspended") void context.resume();
        const input = event.inputBuffer.getChannelData(0);
        const now = performance.now();
        const level = rms(input);
        if (level >= 0.008) lastVoiceAt.current = now;
        const open = now - lastVoiceAt.current <= 450;
        if (open !== micLiveRef.current) {
          micLiveRef.current = open;
          setMicLive(open);
        }
        const ratio = context.sampleRate / 8000;
        const length = Math.floor(input.length / ratio);
        if (!length) return;
        const encoded = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
          const start = Math.floor(i * ratio);
          const end = Math.min(input.length, Math.floor((i + 1) * ratio) || start + 1);
          let sum = 0;
          for (let j = start; j < end; j++) sum += input[j] ?? 0;
          const sample = !open || end <= start ? 0 : sum / (end - start);
          encoded[i] = linearToUlaw(sample);
        }
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
            if (monitor.type === "helper_joined") {
              helperRef.current = true;
              setHelperOnPhone(true);
            }
            if ((monitor.type === "user" || monitor.type === "agent" || monitor.type === "helper") && monitor.text) {
              const turn = {
                id: crypto.randomUUID(),
                speaker: monitor.type === "helper" ? "helper" as const : monitor.type === "user" ? "caller" as const : "agent" as const,
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
            if (helperRef.current) return;
            if (context.state === "suspended") void context.resume();
            const bytes = base64ToBytes(message.media.payload);
            const srcRate = 8000;
            const dstRate = context.sampleRate || 48000;
            const dstLen = Math.max(1, Math.round(bytes.length * dstRate / srcRate));
            const buffer = context.createBuffer(1, dstLen, dstRate);
            const channel = buffer.getChannelData(0);
            for (let i = 0; i < dstLen; i++) {
              const srcIndex = Math.min(bytes.length - 1, Math.floor(i * srcRate / dstRate));
              channel[i] = ulawToLinear(bytes[srcIndex] ?? 0xff);
            }
            const playback = context.createBufferSource();
            playback.buffer = buffer;
            playback.connect(context.destination);
            const now = context.currentTime;
            if (playbackAt.current < now - 0.25) playbackAt.current = now;
            playbackAt.current = Math.max(now, playbackAt.current);
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

  const patientUrl = patientAvatarUrl(scenario?.patient ?? "paciente");
  const agentUrl = agentAvatarUrl();

  return (
    <div className={styles.simulator}>
      <header className={styles.intro}>
        <div>
          <h1>Pruebas de voz · Lucía</h1>
          <p>El caso habla por el micro. Si pides una persona, te llama Twilio; pulsa una tecla. En el móvil el paciente pide cita y tú solo dices que sí, que se la coges.</p>
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
              <img src={patientAvatarUrl(line.scenario.patient)} alt="" />
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
            <div className={styles.avatarWrap}>
              {status === "idle" || status === "connecting" ? (
                <>
                  <span className={styles.incomingRing} />
                  <span className={styles.incomingRing} data-delay />
                </>
              ) : null}
              <img className={styles.avatar} src={patientUrl} alt="" />
            </div>
            <h2>{helperOnPhone ? "Recepción (tú en el móvil)" : (scenario?.patient ?? "Paciente de prueba")}</h2>
            <p>{scenario?.phone ?? "Número oculto"}</p>
            <span data-status={status}>
              {status === "idle"
                ? "Llamada entrante"
                : status === "connecting"
                  ? "Conectando"
                  : status === "live"
                    ? (helperOnPhone
                      ? "En el móvil: dile que sí, que le coges la cita"
                      : (micLive ? "Te oigo" : `${liveCount} en línea · micro abierto`))
                    : "Error"}
            </span>
            <div>
              {status === "idle" || status === "error" ? (
                <>
                  <button className={styles.answer} onClick={() => start("one")}><PhoneIcon />Descolgar</button>
                  <button className={styles.fleetStart} onClick={() => start("three")}>3 llamadas a la vez</button>
                </>
              ) : (
                <button className={styles.hangup} onClick={stop}><PhoneIcon hangup />Colgar</button>
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
          <header><h2>Conversación</h2><p>{status === "live" ? (helperOnPhone ? "El paciente de prueba pide la cita en el móvil. Tú solo confirmas que se la coges. Aquí salen en dos turnos, no juntos." : (lines.length > 1 ? "El caso habla por TTS. Oyes a Marta. Las otras dos siguen su guion." : "El caso habla por TTS. Oyes a Marta.")) : turns.length ? "Transcripción conservada tras la llamada." : "Contesta para ver la conversación."}</p></header>
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
                  <span>
                    {item.speaker === "helper" ? "Tú · recepción" : item.speaker === "caller" ? (helperOnPhone ? "Paciente de prueba" : scenario?.patient) : "Marta"}
                    {item.language ? <em>{item.language.toUpperCase()}</em> : null}
                  </span>
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
        Usa auriculares. El micro de la tarjeta seleccionada está abierto. Si te llama Twilio, pulsa una tecla después del anuncio en inglés.
      </footer>
    </div>
  );
}
