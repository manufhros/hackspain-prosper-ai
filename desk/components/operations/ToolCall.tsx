import { Check, ChevronRight, LoaderCircle, Wrench, CircleAlert } from "lucide-react";
import { toolLabels, type Entry } from "./types";
import styles from "./Operations.module.css";

export function toolRows(events: Entry[]) {
  const rows: { event: Entry; result?: Entry; index: number }[] = [];
  for (const [index, event] of events.entries()) {
    if (event.type === "tool_result" || (event.type === "error" && event.toolCallId)) {
      const pending = rows.find(row => row.event.type === "tool" && !row.result &&
        (event.toolCallId ? row.event.toolCallId === event.toolCallId : row.event.name === event.name));
      if (pending) { pending.result = event; continue; }
    }
    rows.push({ event, index });
  }
  return rows;
}

function pretty(value: unknown) {
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return value === undefined ? "No disponible" : JSON.stringify(value, null, 2);
}

export function ToolCall({ event, result, ended }: { event: Entry; result?: Entry; ended?: number }) {
  const output = result ?? (event.type === "tool_result" ? event : undefined);
  let failed = output?.type === "error";
  try { const data = JSON.parse(output?.result ?? "{}"); failed ||= !!data.error || data.is_error === true || data.success === false; } catch { /* Truncated or plain text response. */ }
  const pending = !output && !ended;
  const label = failed ? "Error" : output ? "Completada" : ended ? "Sin respuesta" : "En curso";
  return <details className={styles.toolCall}>
    <summary><ChevronRight size={14} className={styles.toolChevron}/><Wrench size={14}/>
      <span>{toolLabels[event.name ?? ""] ?? event.name ?? "Herramienta"}</span>
      <small className={failed ? styles.toolFailure : ""}>{pending ? <LoaderCircle size={12} className={styles.toolSpinner}/> : failed ? <CircleAlert size={12}/> : output ? <Check size={12}/> : null}{label}</small>
    </summary>
    <div className={styles.toolDetails}><code>{event.name}</code>
      <h4>Entrada</h4><pre>{pretty(event.params)}</pre>
      <h4>Respuesta</h4><pre>{output ? pretty(output.result ?? output.text) : ended ? "La llamada terminó sin una respuesta registrada." : "Esperando respuesta…"}</pre>
    </div>
  </details>;
}
