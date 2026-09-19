"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Square, Phone, Radio, FlaskConical } from "lucide-react";
import { Button } from "./components/button";
import { Badge } from "./components/badge";
import { Chat } from "./Chat";
import { activeRun, duration, isDecision, toolLabels, type Run } from "./types";
import styles from "./Operations.module.css";

const initial: Run = { id: "", state: "idle", message: "", calls: [] };
export function Operations() {
  const [remote, setRemote] = useState<Run>(initial);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(0);
  const revision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = revision.current;
      try {
        const response = await fetch("/api/operations/state", { cache: "no-store", signal: controller.signal });
        const body = await response.json() as Run & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "No se pudo consultar el estado");
        if (version === revision.current) { setRemote(body); setConnected(true); setError(""); }
      } catch (e) {
        if (!controller.signal.aborted) { setConnected(false); setError(e instanceof Error ? e.message : "Sin conexión"); }
      } finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 1500); }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function command(action: "start" | "stop" | "acknowledge", includePhone = true) {
    if (pending) return;
    setPending(true); setError(""); revision.current++;
    try {
      const response = await fetch(`/api/operations/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includePhone }), signal: AbortSignal.timeout(25000),
      });
      const body = await response.json() as Run & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo ejecutar la acción");
      setRemote(body); setConnected(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de conexión"); setConnected(false); }
    finally { revision.current++; setPending(false); }
  }
  const run = remote;
  const call = run.calls.find(item => item.id === selected) ?? run.calls[0];
  const calls = run.calls.filter(item => filter === "all" || (filter === "active" ? !item.ended : !!item.ended));
  const tools = call?.events.filter(event => ["tool", "tool_result", "handoff", "error"].includes(event.type)) ?? [];
  const decision = tools.findLast(isDecision);
  const language = (item: typeof call) => item?.events.findLast(event => event.type === "user" && event.language)?.language;
  const flag = (lang?: string) => lang === "fr" ? "🇫🇷" : lang === "en" ? "🇬🇧" : lang === "es" ? "🇪🇸" : "—";
  return <div className={styles.root}>
    <header className={styles.heading}><div><div className={styles.eyebrow}><Radio size={13}/>CENTRO DE CONTROL</div><h1>Hackspain</h1></div>
      <div className={styles.actions}>
          {activeRun(remote) ? <Button variant="destructive" disabled={pending} onClick={() => command("stop")}><Square/>Detener demo</Button> :
            <Button disabled={pending || !connected} onClick={() => command("start")}><Play/>Start demo</Button>}
      </div>
    </header>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {run.message && <div role="status" className={run.state === "error" || run.state === "uncertain" ? styles.error : styles.notice}>{run.message}</div>}
    {run.state === "uncertain" && <Button variant="outline" disabled={pending} onClick={() => {
      if (window.confirm("¿Has comprobado en Twilio Calls que no queda ninguna llamada de esta demo activa?")) void command("acknowledge");
    }}>He comprobado el cierre en Twilio</Button>}
    <div className={styles.metrics}>
      {[["En curso", run.calls.filter(item => !item.ended).length], ["Con agente", run.calls.filter(item => item.state === "En conversación").length],
        ["Escaladas · ensayo", run.calls.filter(item => item.events.some(event => isDecision(event) && event.name === "submit_escalate")).length],
        ["Finalizadas", run.calls.filter(item => item.ended).length]].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}
    </div>
    <div className={styles.console}>
      <aside className={styles.queue}><header><h2>Llamadas</h2><Badge variant="secondary">{run.calls.length}</Badge></header>
        <div className={styles.filters}>{[["all", "Todas"], ["active", "Activas"], ["ended", "Finalizadas"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        {calls.map(item => <button key={item.id} className={styles.queueItem} aria-pressed={call?.id === item.id} onClick={() => setSelected(item.id)}>
          <strong>{item.name}<span className={styles.flag} title={language(item) ?? "Idioma pendiente"}>{flag(language(item))}</span></strong>
          <span><i className={item.ended ? styles.offline : styles.online}/>{item.state}</span>
          <small>{item.source === "phone" ? <Phone size={12}/> : <FlaskConical size={12}/>} {item.source === "phone" ? "Teléfono" : item.source === "mock" ? "Mock" : "Paciente LLM"}<time>{duration(item.started, item.ended ?? now)}</time></small>
        </button>)}
        {!calls.length && <p className={styles.queueEmpty}>No hay llamadas en esta vista</p>}
      </aside>
      <Chat key={call?.id ?? "empty"} call={call}/>
      <aside className={styles.decisions}><header><h2>Decisiones del agente</h2></header>
        <div className={styles.decision}><span>RESULTADO · ENSAYO</span><h3>{decision ? toolLabels[decision.name ?? ""] : !call ? "Sin llamada" : call.ended ? "Sin acción final" : "En curso"}</h3><p>No modifica citas reales.</p></div>
      </aside>
    </div>
  </div>;
}
