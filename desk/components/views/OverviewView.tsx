import { ArrowRight, Calendar } from "lucide-react";
import { canPath } from "@/lib/auth";
import { euro, num, pct, todayLabel } from "@/lib/format";
import { byConsultation, byOutcome, filterSite, lineMinutes, qualityMetrics } from "@/lib/metrics";
import { pitch, SALES } from "@/lib/sales";
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
import { scopeCrumbs, scopeName, TONE_COLOR, type ViewScope } from "./scope";

export function OverviewView({ scope }: { scope: ViewScope }) {
  const { calls } = scope;
  const p = pitch(calls);
  const quality = qualityMetrics(calls);
  const escalated = calls.filter((call) => call.outcome === "escalado");
  const escalationTrace = escalated.length
    ? pct(escalated.filter((call) => Boolean(call.reason)).length, escalated.length)
    : 100;
  const outcomes = byOutcome(calls).map(([outcome, count]) => {
    const meta = outcomeMeta(outcome);
    return { label: meta.label, value: count, pct: `${pct(count, p.calls)} %`, color: TONE_COLOR[meta.tone] };
  });
  const consultations = byConsultation(calls)
    .slice(0, 6)
    .map((item) => ({ label: item.name, value: item.count, pct: `${pct(item.count, p.calls)} %` }));
  const showBusiness = canPath(scope.role, "/ahorro");

  const siteRows = scope.sites
    .map((hospital) => {
      const siteCalls = filterSite(calls, hospital.siteId);
      const metrics = pitch(siteCalls);
      const costYear = lineMinutes(siteCalls) * SALES.agentMinute * SALES.days;
      return { hospital, metrics, calls: siteCalls.length, costYear, netYear: metrics.agendaYear - costYear };
    })
    .sort((a, b) => b.netYear - a.netYear);
  const maxSiteCalls = Math.max(...siteRows.map((row) => row.calls), 1);

  return (
    <>
      <PageHeader
        crumbs={scopeCrumbs(scope, "Resumen")}
        title={`Buenos días, ${scopeName(scope)}`}
        description={
          scope.kind === "org"
            ? `Así está funcionando la recepción hoy en ${scope.sites.length === 1 ? "vuestro centro" : `vuestros ${scope.sites.length} centros`}.`
            : "Así está funcionando la recepción de este centro hoy."
        }
        actions={
          <>
            <Badge tone="neutral">
              <Calendar size={12} aria-hidden="true" />
              Hoy · {todayLabel()}
            </Badge>
            {scope.live ? (
              <Badge tone="success" dot>
                Datos reales
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Datos de demostración
              </Badge>
            )}
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Llamadas atendidas"
          value={num(p.calls)}
          icon="phone"
          delta={{ label: scope.live ? "En directo" : "Demo", tone: scope.live ? "success" : "neutral" }}
          hint={`${num(lineMinutes(calls))} min de conversación`}
        />
        <StatCard
          label="Citas cerradas"
          value={num(p.citas)}
          icon="calendar"
          delta={{ label: `${p.booked} %`, tone: "brand" }}
          hint="de las llamadas terminan con cita"
        />
        <StatCard
          label="Escalados a persona"
          value={num(p.esc)}
          icon="escalation"
          delta={{ label: `${escalationTrace} %`, tone: escalationTrace >= 90 ? "success" : "warning" }}
          hint="con motivo registrado"
        />
        <StatCard
          label="Resuelto sin mostrador"
          value={`${p.kept} %`}
          icon="activity"
          delta={{ label: num(p.calls - p.esc), tone: "info" }}
          hint="llamadas autónomas"
        />
      </StatGrid>

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

      {scope.kind === "org" && scope.sites.length > 1 ? (
        <Card
          flush
          title="Actividad por centro"
          description="Volumen, citas y valor neto estimado de agenda menos coste de voz"
          actions={
            showBusiness ? (
              <ButtonLink href={`${scope.base}/ahorro`} variant="ghost" size="sm" icon={ArrowRight}>
                Ver cómo se calcula
              </ButtonLink>
            ) : (
              <Badge tone="neutral">{scope.sites.length} centros</Badge>
            )
          }
        >
          <DataTable
            unit="centros"
            columns={[
              { key: "centro", header: "Centro", width: "30%" },
              { key: "dist", header: "Distribución", width: "24%" },
              { key: "llamadas", header: "Llamadas", align: "right" },
              { key: "citas", header: "Citas", align: "right" },
              { key: "coste", header: "Coste anual", align: "right" },
              { key: "neto", header: "Valor neto", align: "right" },
            ]}
            rows={siteRows.map(({ hospital, metrics, calls: siteCalls, costYear, netYear }) => ({
              id: hospital.id,
              cells: [
                <Entity key="e" name={hospital.name} meta={hospital.city} initials={hospital.initials} tint={hospital.tint} square />,
                <span key="d" className="bar-inline" aria-hidden="true">
                  <i style={{ width: `${Math.max(3, Math.round((siteCalls / maxSiteCalls) * 100))}%`, background: hospital.tint }} />
                </span>,
                num(siteCalls),
                num(metrics.citas),
                euro(costYear),
                <strong key="n" style={{ color: "var(--success)" }}>
                  {euro(netYear)}
                </strong>,
              ],
            }))}
          />
        </Card>
      ) : null}

      <Grid2 even>
        <Card title="Calidad de la atención" description="Señales medidas en las llamadas de hoy">
          <KeyValues
            items={[
              ["Frustración media", `${quality.frustration} / 100`],
              ["Latencia de herramientas", quality.avgLatencyMs == null ? "—" : `${quality.avgLatencyMs} ms`],
              ["Ejecuciones con error", `${quality.toolErrorRate} %`],
              ["Valoración del paciente", quality.patientRating == null ? "Sin encuesta" : `${quality.patientRating.toFixed(1)} / 5`],
            ]}
          />
        </Card>
        {showBusiness ? (
          <Card
            title="Valor anual estimado de las citas"
            description={`Proyección comercial · ${SALES.ticket} € por cita · ${SALES.days} días`}
            actions={
              <ButtonLink href={`${scope.base}/ahorro`} variant="ghost" size="sm" icon={ArrowRight}>
                Negocio
              </ButtonLink>
            }
          >
            <StatCard label="Agenda captada al año" value={euro(p.agendaYear)} emphasis hint={`${euro(p.agendaDay)} hoy`} />
          </Card>
        ) : (
          <Card title="Hoy en cifras" description="Resumen operativo del día">
            <KeyValues
              items={[
                ["Citas", num(p.citas)],
                ["Altas de paciente", num(p.altas)],
                ["Llamadas", num(p.calls)],
                ["Pasadas a mostrador", num(p.esc)],
              ]}
            />
          </Card>
        )}
      </Grid2>
    </>
  );
}
