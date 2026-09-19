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
import { CLINIC, SITES, UNASSIGNED_SITE } from "@/lib/clinic";
import { euro, num, pct, todayLabel } from "@/lib/format";
import { byConsultation, byOutcome, filterSite, lineMinutes } from "@/lib/metrics";
import { pitch, SALES } from "@/lib/sales";
import type { LoggedCall } from "@/lib/types";

const TONE_COLOR: Record<string, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  brand: "var(--brand-2)",
  neutral: "var(--faint)",
};

export function Overview({ calls, role }: { calls: LoggedCall[]; role: Role }) {
  const p = pitch(calls);
  const minutes = lineMinutes(calls);

  const outcomes = byOutcome(calls).map(([outcome, count]) => {
    const meta = outcomeMeta(outcome);
    return { label: meta.label, value: count, pct: `${pct(count, p.calls)} %`, color: TONE_COLOR[meta.tone] };
  });
  const consultations = byConsultation(calls)
    .slice(0, 6)
    .map((item) => ({ label: item.name, value: item.count, pct: `${pct(item.count, p.calls)} %` }));

  const siteRows = [...SITES, UNASSIGNED_SITE]
    .map((site) => {
      const siteCalls = filterSite(calls, site.id === UNASSIGNED_SITE.id ? null : site.id);
      const metrics = pitch(siteCalls);
      return { site, calls: siteCalls.length, citas: metrics.citas, esc: metrics.esc, minutes: lineMinutes(siteCalls) };
    })
    .filter((row) => row.calls > 0)
    .sort((a, b) => b.calls - a.calls);
  const maxSiteCalls = Math.max(...siteRows.map((row) => row.calls), 1);

  return (
    <>
      <PageHeader
        eyebrow="Resumen de hoy"
        title={CLINIC.name}
        description={`Así está funcionando la recepción telefónica en los ${SITES.length} centros. Todo lo que ves sale de las llamadas atendidas por el agente.`}
        actions={
          <>
            <Badge tone="neutral">
              <Calendar size={12} aria-hidden="true" />
              Hoy · {todayLabel()}
            </Badge>
            <ButtonLink href="/panel/llamadas" variant="secondary" size="sm" icon={ArrowRight}>
              Ver llamadas
            </ButtonLink>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Llamadas atendidas"
          value={num(p.calls)}
          icon="phone"
          delta={{ label: "Datos reales", tone: "success" }}
          hint={`${num(minutes)} min de conversación`}
        />
        <StatCard
          label="Citas reservadas"
          value={num(p.citas)}
          icon="dashboard"
          delta={{ label: `${p.booked} %`, tone: "brand" }}
          hint="de las llamadas terminan con cita"
        />
        <StatCard
          label="Pasadas a una persona"
          value={num(p.esc)}
          icon="phone"
          delta={{ label: `${pct(p.esc, p.calls)} %`, tone: p.esc ? "warning" : "success" }}
          hint="el resto lo resolvió el agente"
        />
        <StatCard
          label="Altas de paciente"
          value={num(p.altas)}
          icon="dashboard"
          delta={{ label: "Nuevos", tone: "info" }}
          hint="registrados por teléfono"
        />
      </StatGrid>

      {role === "admin" ? <AgentFleet /> : null}

      <Grid2>
        <Card
          title="Resultado de las llamadas"
          description="Cómo termina cada conversación"
          actions={<Badge tone="neutral">{num(p.calls)} llamadas</Badge>}
        >
          {outcomes.length ? <BarList rows={outcomes} /> : <Note>Todavía no hay llamadas registradas hoy.</Note>}
        </Card>
        <Card
          title="Consultas más recibidas"
          description="Motivo principal detectado durante la llamada"
          actions={<Badge tone="neutral">Top {consultations.length}</Badge>}
        >
          {consultations.length ? <BarList rows={consultations} /> : <Note>Sin motivos clasificados todavía.</Note>}
        </Card>
      </Grid2>

      <Card
        flush
        title="Actividad por centro"
        description="Volumen y resultado en cada sede. Las consultas generales y las altas no se ligan a un centro."
        actions={<Badge tone="neutral">{SITES.length} centros</Badge>}
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
          rows={siteRows.map(({ site, calls: siteCalls, citas, esc, minutes: siteMinutes }) => ({
            id: site.id,
            cells: [
              <Entity key="e" name={site.name} meta={site.city} initials={site.initials} tint={site.tint} square />,
              <span key="d" className="bar-inline" aria-hidden="true">
                <i style={{ width: `${Math.max(3, Math.round((siteCalls / maxSiteCalls) * 100))}%`, background: site.tint }} />
              </span>,
              num(siteCalls),
              num(citas),
              num(esc),
              num(siteMinutes),
            ],
          }))}
        />
      </Card>

      <Grid2>
        <Card
          title="Lo que vale la agenda de hoy"
          description={`Proyección a ${SALES.days} jornadas si se mantiene el ritmo de hoy`}
        >
          <StatCard label="Agenda captada al año" value={euro(p.agendaYear)} emphasis hint={`${euro(p.agendaDay)} hoy · ${SALES.ticket} € por cita`} />
          <div style={{ height: 14 }} />
          <KeyValues
            items={[
              ["Admisión que no hace falta contratar", `${euro(p.deskYear)} · ${p.ftes.toFixed(1)} FTE`],
              ["Llamadas que no se pierden en el buzón", euro(p.missedYear)],
              ["Pacientes nuevos, primer año", euro(p.pipelineYear)],
            ]}
          />
        </Card>
        <Card title="Cómo se calcula" description="Hipótesis comerciales; no salen del registro de llamadas">
          <KeyValues
            items={[
              ["Ticket medio por cita", `${SALES.ticket} €`],
              ["Valor de un paciente nuevo, año 1", `${SALES.newPatient} €`],
              ["Coste hora de admisión", `${SALES.hour} €`],
              ["Minutos por llamada atendida a mano", `${SALES.minutes} min`],
              ["Jornadas al año", `${SALES.days}`],
              ["Llamadas perdidas sin línea", `${Math.round(SALES.missedWithout * 100)} %`],
            ]}
          />
        </Card>
      </Grid2>
    </>
  );
}
