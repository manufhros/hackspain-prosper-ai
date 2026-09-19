"use client";

import type { LoggedCall } from "@/lib/types";
import { num, timeOf } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Gauge, Search } from "lucide-react";
import { Badge, Button, Card, type Crumb, Note, OutcomeBadge, PageHeader, StatCard, StatGrid, outcomeMeta } from "./ui/primitives";
import ui from "./ui/ui.module.css";
import styles from "./CallMonitor.module.css";

const TABS = [
  { value: "cita", label: "Citas" },
  { value: "escalado", label: "Escalados" },
  { value: "sin_cita", label: "Sin cita" },
  { value: "sin_cierre", label: "Sin cierre" },
  { value: "__errors", label: "Con errores" },
] as const;

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function matchesTab(call: LoggedCall, tab: string) {
  if (tab === "__all") return true;
  if (tab === "__errors") return (call.toolErrors ?? 0) > 0;
  return call.outcome === tab;
}

export function CallMonitor({
  calls,
  title,
  source = "llamadas",
  crumbs,
  refreshMs = 8_000,
}: {
  calls: LoggedCall[];
  title: string;
  source?: "llamadas" | "demo";
  crumbs?: Crumb[];
  refreshMs?: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("__all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!refreshMs) return;
    const timer = window.setInterval(() => router.refresh(), refreshMs);
    return () => window.clearInterval(timer);
  }, [router, refreshMs]);

  const recent = useMemo(() => calls.slice(0, 120), [calls]);
  const errors = recent.reduce((sum, call) => sum + (call.toolErrors ?? 0), 0);
  const toolCalls = recent.reduce((sum, call) => sum + (call.toolCalls ?? 0), 0);
  const escalated = recent.filter((call) => call.outcome === "escalado").length;
  const frustration = recent.length
    ? Math.round(recent.reduce((sum, call) => sum + (call.frustrationScore ?? 0), 0) / recent.length)
    : 0;
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of TABS) map.set(item.value, recent.filter((call) => matchesTab(call, item.value)).length);
    return map;
  }, [recent]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recent.filter(
      (call) =>
        matchesTab(call, tab) &&
        (!q || `${call.patient ?? ""} ${call.siteName} ${call.motive} ${call.reason ?? ""}`.toLowerCase().includes(q)),
    );
  }, [recent, tab, query]);

  function exportJson() {
    download(
      `llamadas-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), source, calls }, null, 2),
      "application/json",
    );
  }

  function exportCsv() {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["id", "fecha", "paciente", "centro", "resultado", "motivo", "frustracion", "latencia_ms", "errores", "acciones"],
      ...calls.map((call) => [
        call.id,
        call.started,
        call.patient,
        call.siteName,
        call.outcome,
        call.reason ?? call.motive,
        call.frustrationScore ?? 0,
        call.avgToolLatencyMs,
        call.toolErrors ?? 0,
        call.actions?.map((action) => `${action.name}${action.reason ? `:${action.reason}` : ""}`).join(" | ") ?? "",
      ]),
    ];
    download(
      `llamadas-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((row) => row.map(quote).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  const live = source === "llamadas";

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={title}
        description={
          live
            ? "Llamadas reales, decisiones y acciones ejecutadas por el agente. Se actualiza solo."
            : "Actividad de demostración para este grupo hospitalario."
        }
        actions={
          <>
            <Badge tone={live ? "success" : "neutral"} dot>
              {live ? `En directo · ${refreshMs / 1000} s` : "Demo"}
            </Badge>
            <Button variant="secondary" size="sm" icon={Download} onClick={exportJson}>
              JSON
            </Button>
            <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv}>
              CSV
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatCard label="Llamadas visibles" value={num(recent.length)} icon="phone" hint={`de ${num(calls.length)} registradas`} />
        <StatCard
          label="Escalados"
          value={num(escalated)}
          icon="escalation"
          delta={{ label: recent.length ? `${Math.round((escalated / recent.length) * 100)} %` : "—", tone: escalated ? "warning" : "success" }}
          hint="pasaron a una persona"
        />
        <StatCard
          label="Errores de herramienta"
          value={num(errors)}
          icon="activity"
          delta={{ label: toolCalls ? `${Math.round((errors / toolCalls) * 100)} %` : "0 %", tone: errors ? "danger" : "success" }}
          hint={`de ${num(toolCalls)} ejecuciones`}
        />
        <StatCard
          label="Frustración media"
          value={`${frustration} / 100`}
          icon={Gauge}
          delta={{ label: frustration >= 50 ? "Alta" : frustration >= 25 ? "Media" : "Baja", tone: frustration >= 50 ? "danger" : frustration >= 25 ? "warning" : "success" }}
          hint="umbral de escalado 75"
        />
      </StatGrid>

      <Card flush>
        <div className={ui.toolbar}>
          <div className={ui.tabs} role="tablist">
            <button type="button" role="tab" className={ui.tab} data-active={tab === "__all"} aria-selected={tab === "__all"} onClick={() => setTab("__all")}>
              Todas <b>{recent.length}</b>
            </button>
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                className={ui.tab}
                data-active={tab === item.value}
                aria-selected={tab === item.value}
                onClick={() => setTab(item.value)}
              >
                {item.label} <b>{counts.get(item.value) ?? 0}</b>
              </button>
            ))}
          </div>
          <label className={ui.search}>
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Buscar paciente, centro o motivo…"
              aria-label="Buscar llamadas"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {visible.length ? (
          <div className={styles.list}>
            {visible.map((call) => {
              const meta = outcomeMeta(call.outcome);
              const frustrated = (call.frustrationScore ?? 0) >= 50;
              return (
                <details key={call.id} className={styles.row}>
                  <summary>
                    <i className={styles.dot} data-tone={meta.tone} aria-hidden="true" />
                    <span className={styles.who}>
                      <strong data-anon={!call.patient}>{call.patient || "Paciente sin identificar"}</strong>
                      <small>
                        {timeOf(call.started)} · {call.siteName}
                      </small>
                    </span>
                    <span className={styles.what} title={call.motive}>
                      {call.motive || <span className="muted">Motivo no registrado</span>}
                    </span>
                    <span className={styles.state}>
                      <OutcomeBadge outcome={call.outcome} />
                    </span>
                    <span className={styles.quality} data-warn={frustrated}>
                      <Gauge size={13} aria-hidden="true" />
                      {call.frustrationScore ?? 0}/100
                    </span>
                    <span className={styles.actions}>{call.actions?.length ?? call.toolCalls ?? 0}</span>
                    <ChevronDown size={15} className={styles.chevron} aria-hidden="true" />
                  </summary>
                  <div className={styles.trace}>
                    <header>
                      <strong>Registro de decisiones</strong>
                      <span>
                        {call.reason ? `Motivo: ${call.reason} · ` : ""}
                        {call.avgToolLatencyMs == null ? "Latencia no disponible" : `${call.avgToolLatencyMs} ms por herramienta`} · config{" "}
                        {call.configVersion?.slice(0, 8) || "legacy"}
                      </span>
                    </header>
                    {call.actions?.length ? (
                      <ol>
                        {call.actions.map((action, index) => (
                          <li key={`${action.name}-${index}`}>
                            <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span>
                            <div>
                              <code>{action.name}</code>
                              <strong>{action.summary}</strong>
                              <small>
                                {action.at ? timeOf(action.at) : "Hora no disponible"}
                                {action.reason ? ` · ${action.reason}` : ""}
                              </small>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className={styles.traceEmpty}>Este registro no incluye acciones estructuradas.</p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            <Note>
              {recent.length
                ? "Ninguna llamada coincide con el filtro actual."
                : live
                  ? "Todavía no hay llamadas registradas. En cuanto entre una aparecerá aquí."
                  : "Esta cuenta de demostración no tiene actividad."}
            </Note>
          </div>
        )}
      </Card>
    </>
  );
}
