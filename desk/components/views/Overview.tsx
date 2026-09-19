import { ArrowRight, Calendar } from "lucide-react";
import { AgentFleet } from "@/components/AgentFleet";
import { DataTable } from "@/components/ui/DataTable";
import {
  Badge,
  BarList,
  ButtonLink,
  Card,
  Entity,
  Grid2,
  KeyValues,
  Note,
  PageHeader,
  StatCard,
  StatGrid,
  outcomeMeta,
} from "@/components/ui/primitives";
import type { Role } from "@/lib/auth";
import { siteOf } from "@/lib/clinic";
import { num, pct, todayLabel } from "@/lib/format";
import { byConsultation, byOutcome, filterSite, lineMinutes } from "@/lib/metrics";
import { callCounts, ORIGIN_LABEL, type OriginFilter } from "@/lib/reporting";
import type { ClinicDirectory } from "@/lib/clinic-catalog";
import type { LoggedCall } from "@/lib/types";

const TONE_COLOR: Record<string, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  brand: "var(--brand-2)",
  neutral: "var(--faint)",
};

export function Overview({ calls: allCalls, role, directory, origin, now }: {
  calls: LoggedCall[]; role: Role; directory: ClinicDirectory; origin: OriginFilter; now: Date;
}) {
  const calls = origin === "all" ? allCalls : allCalls.filter(call => (call.origin ?? "unknown") === origin);
  const p = callCounts(calls);
  const minutes = lineMinutes(calls);

  const outcomes = byOutcome(calls).map(([outcome, count]) => {
    const meta = outcomeMeta(outcome);
    return { label: meta.label, value: count, pct: `${pct(count, p.calls)} %`, color: TONE_COLOR[meta.tone] };
  });
  const consultations = byConsultation(calls)
    .slice(0, 6)
    .map((item) => ({ label: item.name, value: item.count, pct: `${pct(item.count, p.calls)} %` }));

  const siteRows = [...new Set(calls.map(call => call.site || null))]
    .map((id) => {
      const site = siteOf(id, directory.sites);
      const siteCalls = filterSite(calls, id);
      const metrics = callCounts(siteCalls);
      return { site, calls: siteCalls.length, citas: metrics.citas, esc: metrics.esc,
        minutes: metrics.measured ? lineMinutes(siteCalls) : null, measured: metrics.measured };
    })
    .filter((row) => row.calls > 0)
    .sort((a, b) => b.calls - a.calls);
  const maxSiteCalls = Math.max(...siteRows.map((row) => row.calls), 1);

  return (
    <>
      <PageHeader
        eyebrow="Resumen de hoy"
        title={directory.name}
        description="Llamadas iniciadas hoy, de 00:00 a 24:00 en Madrid. Se actualiza automáticamente."
        actions={
          <>
            <Badge tone="neutral">
              <Calendar size={12} aria-hidden="true" />
              Hoy · {todayLabel(now)}
            </Badge>
            <ButtonLink href="/panel/llamadas" variant="secondary" size="sm" icon={ArrowRight}>
              Ver llamadas
            </ButtonLink>
          </>
        }
      />

      <nav aria-label="Origen de las llamadas" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(Object.keys(ORIGIN_LABEL) as OriginFilter[]).map(key => (
          <ButtonLink key={key} href={`/panel?origin=${key}`} current={origin === key} size="sm" variant={origin === key ? "primary" : "secondary"}>
            {ORIGIN_LABEL[key]} · {num(key === "all" ? allCalls.length : allCalls.filter(call => (call.origin ?? "unknown") === key).length)}
          </ButtonLink>
        ))}
      </nav>
      <Note>{origin === "all" ? "Este resumen incluye telefonía, pruebas y llamadas sin origen registrado." : `Origen seleccionado: ${ORIGIN_LABEL[origin]}.`}
        {" "}Los registros antiguos sin origen no se consideran telefonía confirmada.
      </Note>
      {!directory.available ? <Note>No se pudo consultar el directorio de centros. Las sedes se muestran por su identificador.</Note> : null}

      <StatGrid>
        <StatCard
          label="Llamadas registradas"
          value={num(p.calls)}
          icon="phone"
          delta={{ label: ORIGIN_LABEL[origin], tone: "neutral" }}
          hint={p.measured ? `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(minutes)} min medidos · ${p.measured}/${p.calls} llamadas` : "Duración no disponible"}
        />
        <StatCard
          label="Citas reservadas"
          value={num(p.citas)}
          icon="dashboard"
          delta={{ label: `${pct(p.citas, p.calls)} %`, tone: "brand" }}
          hint="de las llamadas terminan con cita"
        />
        <StatCard
          label="Escalados registrados"
          value={num(p.esc)}
          icon="phone"
          delta={{ label: `${pct(p.esc, p.calls)} %`, tone: p.esc ? "warning" : "success" }}
          hint="derivaciones solicitadas al equipo humano"
        />
        <StatCard
          label="Altas de paciente"
          value={num(p.altas)}
          icon="dashboard"
          delta={{ label: "Nuevos", tone: "info" }}
          hint="altas registradas en estas llamadas"
        />
      </StatGrid>

      {role === "admin" ? <AgentFleet /> : null}

      <Grid2>
        <Card
          title="Resultado de las llamadas"
          description="Resultado registrado por el agente; incluye llamadas sin cierre"
          actions={<Badge tone="neutral">{num(p.calls)} llamadas</Badge>}
        >
          {outcomes.length ? <BarList rows={outcomes} /> : <Note>No hay llamadas de este origen registradas hoy.</Note>}
        </Card>
        <Card
          title="Motivos registrados"
          description="Clasificación registrada por el agente, sin inferir especialidades"
          actions={<Badge tone="neutral">Top {consultations.length}</Badge>}
        >
          {consultations.length ? <BarList rows={consultations} /> : <Note>Sin motivos clasificados todavía.</Note>}
        </Card>
      </Grid2>

      <Card
        flush
        title="Actividad por centro"
        description="Volumen y resultado según la sede guardada en cada llamada. Minutos solo de llamadas con duración medida."
        actions={<Badge tone="neutral">{directory.available ? `${directory.sites.length} centros en directorio` : "Directorio no disponible"}</Badge>}
      >
        <DataTable
          unit="centros"
          columns={[
            { key: "centro", header: "Centro", width: "32%" },
            { key: "dist", header: "Distribución", width: "26%" },
            { key: "llamadas", header: "Llamadas", align: "right" },
            { key: "citas", header: "Citas", align: "right" },
            { key: "esc", header: "A persona", align: "right" },
            { key: "min", header: "Minutos", align: "right" },
          ]}
          rows={siteRows.map(({ site, calls: siteCalls, citas, esc, minutes: siteMinutes, measured }) => ({
            id: site.id,
            cells: [
              <Entity key="e" name={site.name} meta={site.city} initials={site.initials} tint={site.tint} square />,
              <span key="d" className="bar-inline" aria-hidden="true">
                <i style={{ width: `${Math.max(3, Math.round((siteCalls / maxSiteCalls) * 100))}%`, background: site.tint }} />
              </span>,
              num(siteCalls),
              num(citas),
              num(esc),
              siteMinutes == null ? "—" : `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(siteMinutes)} (${measured}/${siteCalls})`,
            ],
          }))}
        />
      </Card>

      <Grid2>
        <Card title="Actividad registrada" description="Resultados y mediciones del periodo seleccionado">
          <KeyValues items={[
            ["Citas canceladas", num(calls.filter(call => call.outcome === "cancelacion").length)],
            ["Citas modificadas", num(calls.filter(call => call.outcome === "cambio").length)],
            ["Pendientes de resultado final", num(p.active)],
            ["Llamadas sin cierre registrado", num(p.unresolved)],
          ]} />
        </Card>
        <Card title="Cobertura de los datos" description="Lo que consta en el registro de estas llamadas">
          <KeyValues items={[
            ["Con duración medida", `${p.measured} / ${p.calls}`],
            ["Con motivo clasificado", `${calls.filter(call => call.intent).length} / ${p.calls}`],
            ["Con sede registrada", `${calls.filter(call => call.site).length} / ${p.calls}`],
            ["Con origen registrado", `${calls.filter(call => call.origin && call.origin !== "unknown").length} / ${p.calls}`],
          ]} />
          <Note>Ingresos, costes y ahorro no disponibles: no hay precios, facturación ni una base histórica de personal y llamadas perdidas conectados.</Note>
        </Card>
      </Grid2>
    </>
  );
}
