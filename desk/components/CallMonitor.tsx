"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Clock, Download, Radio, Search, X } from "lucide-react";
import { ORIGIN_LABEL } from "@/lib/reporting";
import { siteOf, type Site } from "@/lib/clinic";
import { num, pct, timeOf } from "@/lib/format";
import { reasonLabel } from "@/lib/labels";
import type { LoggedCall } from "@/lib/types";
import { Badge, Button, ButtonLink, Card, type Crumb, Note, OutcomeBadge, PageHeader, StatCard, StatGrid, outcomeMeta } from "./ui/primitives";
import ui from "./ui/ui.module.css";
import styles from "./CallMonitor.module.css";
import { CallRefresh } from "./CallRefresh";
import { useCallListState } from "./CallListState";

const TABS = [
  { value: "cita", label: "Citas" },
  { value: "alta", label: "Altas" },
  { value: "escalado", label: "Escalados" },
  { value: "sin_cita", label: "Sin cita" },
  { value: "sin_cierre", label: "Sin cierre" },
] as const;

const PAGE_SIZE = 40;

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function durationLabel(minutes: number | null) {
  if (minutes == null) return "—";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(minutes)} min`;
}

export function CallMonitor({
  calls,
  title,
  description,
  crumbs,
  refreshMs = 8_000,
  sites = [],
  liveHref,
}: {
  calls: LoggedCall[];
  sites?: Site[];
  title: string;
  description?: string;
  crumbs?: Crumb[];
  refreshMs?: number;
  liveHref?: string;
}) {
  const { tab, setTab, query, setQuery, page, setPage } = useCallListState();
  const searchInput = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const call of calls) map.set(call.outcome, (map.get(call.outcome) ?? 0) + 1);
    return map;
  }, [calls]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calls.filter(
      (call) =>
        (tab === "__all" || call.outcome === tab) &&
        (!q ||
          `${call.patient ?? ""} ${siteOf(call.site, sites).name} ${call.motive} ${reasonLabel(call.reason) ?? ""} ${outcomeMeta(call.outcome).label}`
            .toLowerCase()
            .includes(q)),
    );
  }, [calls, tab, query, sites]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const escalated = counts.get("escalado") ?? 0;
  const unresolved = counts.get("sin_cierre") ?? 0;

  function exportJson() {
    download(
      `llamadas-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), calls }, null, 2),
      "application/json",
    );
  }

  function exportCsv() {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["id", "fecha", "paciente", "centro", "resultado", "motivo_codigo", "lo_que_dijo", "minutos", "origen", "acciones"],
      ...calls.map((call) => [
        call.id,
        call.started,
        call.patient,
        siteOf(call.site, sites).name,
        call.outcome,
        reasonLabel(call.reason) ?? "",
        call.motive,
        call.minutes,
        call.origin ?? "unknown",
        call.actions?.map((action) => action.name).join(" | ") ?? "",
      ]),
    ];
    download(
      `llamadas-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((row) => row.map(quote).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  return (
    <>
      <CallRefresh interval={refreshMs} />
      <PageHeader
        crumbs={crumbs}
        title={title}
        description={description}
        actions={
          <>
            <Badge tone="success" dot>
              Live
            </Badge>
            {liveHref ? (
              <ButtonLink href={liveHref} variant="secondary" size="sm" icon={Radio}>
                Ver en tiempo real
              </ButtonLink>
            ) : null}
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
        <StatCard label="Llamadas registradas" value={num(calls.length)} icon="phone" hint="últimas 500, todas las sedes" />
        <StatCard
          label="Citas reservadas"
          value={num(counts.get("cita") ?? 0)}
          icon="dashboard"
          delta={{ label: `${pct(counts.get("cita") ?? 0, calls.length)} %`, tone: "brand" }}
          hint="de las llamadas"
        />
        <StatCard
          label="Escalados registrados"
          value={num(escalated)}
          icon="phone"
          delta={{ label: `${pct(escalated, calls.length)} %`, tone: escalated ? "warning" : "success" }}
          hint="con el motivo registrado"
        />
        <StatCard
          label="Sin cierre registrado"
          value={num(unresolved)}
          icon={Clock}
          delta={{ label: `${pct(unresolved, calls.length)} %`, tone: "neutral" }}
          hint="sin resultado final confirmado"
        />
      </StatGrid>

      <Card flush>
        <div className={ui.toolbar}>
          <div className={ui.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              className={ui.tab}
              data-active={tab === "__all"}
              aria-selected={tab === "__all"}
              onClick={() => {
                setTab("__all");
                setPage(0);
              }}
            >
              Todas <b>{calls.length}</b>
            </button>
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                className={ui.tab}
                data-active={tab === item.value}
                aria-selected={tab === item.value}
                onClick={() => {
                  setTab(item.value);
                  setPage(0);
                }}
              >
                {item.label} <b>{counts.get(item.value) ?? 0}</b>
              </button>
            ))}
          </div>
          <div className={ui.search}>
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchInput}
              type="search"
              value={query}
              placeholder="Buscar paciente, centro o motivo…"
              aria-label="Buscar llamadas"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
            {query ? <button type="button" aria-label="Borrar búsqueda" className={styles.clearSearch}
              onClick={() => { setQuery(""); setPage(0); searchInput.current?.focus(); }}>
              <X size={14} aria-hidden="true" />
            </button> : null}
          </div>
        </div>

        {visible.length ? (
          <div className={styles.list}>
            {visible.map((call) => {
              const meta = outcomeMeta(call.outcome);
              const reason = reasonLabel(call.reason);
              const site = siteOf(call.site, sites);
              return (
                <Link key={call.id} href={`/panel/llamadas/${encodeURIComponent(call.id)}`}
                  prefetch={false} className={styles.row}
                  aria-label={`Ver llamada de ${call.patient || "paciente sin identificar"}, ${timeOf(call.started)}`}>
                    <i className={styles.dot} data-tone={meta.tone} aria-hidden="true" />
                    <span className={styles.who}>
                      <strong data-anon={!call.patient}>{call.patient || "Paciente sin identificar"}</strong>
                      <small>
                        {timeOf(call.started)} · {site.name} · {ORIGIN_LABEL[call.origin ?? "unknown"]}
                      </small>
                    </span>
                    <span className={styles.what} title={call.motive}>
                      {call.motive || <span className="muted">Motivo no registrado</span>}
                    </span>
                    <span className={styles.state}>
                      <OutcomeBadge outcome={call.outcome} />
                      {reason ? <small>{reason}</small> : null}
                    </span>
                    <span className={styles.quality}>
                      <Clock size={13} aria-hidden="true" />
                      {durationLabel(call.minutes)}
                    </span>
                    <span className={styles.actions} title="Acciones del agente">
                      {call.actions?.length ?? call.toolCalls ?? "—"}
                    </span>
                    <ChevronRight size={15} className={styles.chevron} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            <Note>
              {calls.length
                ? "Ninguna llamada coincide con el filtro actual."
                : "Todavía no hay llamadas registradas. En cuanto entre una aparecerá aquí."}
            </Note>
          </div>
        )}

        {filtered.length > PAGE_SIZE || filtered.length !== calls.length ? (
          <div className={ui.tableFoot}>
            <span>
              Mostrando {filtered.length ? current * PAGE_SIZE + 1 : 0}–{current * PAGE_SIZE + visible.length} de {filtered.length} llamadas
              {filtered.length !== calls.length ? ` · ${calls.length} en total` : ""}
            </span>
            {pages > 1 ? (
              <div className={ui.pager}>
                <button type="button" aria-label="Página anterior" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <span>
                  {current + 1} / {pages}
                </span>
                <button
                  type="button"
                  aria-label="Página siguiente"
                  disabled={current >= pages - 1}
                  onClick={() => setPage(current + 1)}
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    </>
  );
}
