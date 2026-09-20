import Link from "next/link";
import { ArrowRight, Calendar, Radio, Settings } from "lucide-react";
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
import { num, pct, periodLabel, euro, hours } from "@/lib/format";
import { byConsultation, byOutcome, filterSite, lineMinutes, periodEconomics, openBreakdown, VALUE_RATES } from "@/lib/metrics";
import { callCounts, filterLine, LINE_LABEL, lineCalls, type LineFilter } from "@/lib/reporting";
import type { ClinicDirectory } from "@/lib/clinic-catalog";
import type { Organisation } from "@/lib/orgs";
import { ORGANISATIONS } from "@/lib/orgs";
import type { LoggedCall } from "@/lib/types";

const TONE_COLOR: Record<string, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  brand: "var(--brand-2)",
  neutral: "var(--faint)",
};

function lineHref(line: LineFilter, org?: string | null, analysis = false) {
  const params = new URLSearchParams();
  if (line !== "all") params.set("linea", line);
  if (org) params.set("org", org);
  if (analysis) params.set("analisis", "efecto");
  const query = params.toString();
  return query ? `/panel?${query}` : "/panel";
}

export function Overview({
  calls: allCalls,
  role,
  directory,
  line,
  range,
  organisations,
  selectedOrg = null,
  analysis = false,
}: {
  calls: LoggedCall[];
  role: Role;
  directory: ClinicDirectory;
  line: LineFilter;
  range: { from: string; to: string; days: number };
  organisations?: Array<{ organisation: Organisation; calls: LoggedCall[] }>;
  selectedOrg?: string | null;
  analysis?: boolean;
}) {
  if (role === "admin" && organisations) {
    return (
      <OrganisationOverview organisations={organisations} range={range} analysis={analysis} />
    );
  }

  const live = lineCalls(allCalls);
  const calls = filterLine(allCalls, line);
  const economics = periodEconomics(live);
  const open = openBreakdown(live);
  const deskLive = live.filter((call) => call.outcome === "escalado").length;
  const p = callCounts(calls);
  const minutes = lineMinutes(calls);

  const outcomes = byOutcome(calls).map(([outcome, count]) => {
    const meta = outcomeMeta(outcome);
    return { label: meta.label, value: count, pct: `${pct(count, p.calls)} %`, color: TONE_COLOR[meta.tone] };
  });
  const consultations = byConsultation(calls)
    .slice(0, 6)
    .map((item) => ({ label: item.name, value: item.count, pct: `${pct(item.count, p.calls)} %` }));

  const siteRows = [...new Set(calls.map((call) => call.site || null))]
    .map((id) => {
      const site = siteOf(id, directory.sites);
      const siteCalls = filterSite(calls, id);
      const metrics = callCounts(siteCalls);
      return {
        site,
        calls: siteCalls.length,
        citas: metrics.citas,
        esc: metrics.esc,
        minutes: metrics.measured ? lineMinutes(siteCalls) : null,
        measured: metrics.measured,
      };
    })
    .filter((row) => row.calls > 0 && row.site.id !== "none")
    .sort((a, b) => b.calls - a.calls);
  const maxSiteCalls = Math.max(...siteRows.map((row) => row.calls), 1);

  return (
    <>
      <PageHeader
        crumbs={role === "admin" ? [{ label: "Resumen", href: "/panel" }, { label: directory.name }] : undefined}
        eyebrow="Resumen"
        title={directory.name}
        description={`Llamadas de los últimos ${range.days} días, en horario de Madrid. Se actualiza automáticamente.`}
        actions={
          <>
            <Badge tone="neutral">
              <Calendar size={12} aria-hidden="true" />
              {range.days} días · {periodLabel(range.from, range.to)}
            </Badge>
            <ButtonLink
              href={selectedOrg ? `/panel/llamadas?org=${selectedOrg}` : "/panel/llamadas"}
              variant="secondary"
              size="sm"
              icon={ArrowRight}
            >
              Ver llamadas
            </ButtonLink>
            {role === "clinic" ? (
              <ButtonLink href="/panel/agente" variant="secondary" size="sm" icon={Settings}>
                Configurar agente
              </ButtonLink>
            ) : null}
            {role === "clinic" || role === "admin" ? (
              <ButtonLink href="/panel/pruebas" variant="secondary" size="sm" icon={Radio}>
                Ver en tiempo real
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {role === "admin" ? (
        <nav aria-label="Hospital" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ORGANISATIONS.map((organisation) => (
            <ButtonLink
              key={organisation.slug}
              href={lineHref(line, organisation.slug)}
              current={selectedOrg === organisation.slug}
              size="sm"
              variant={selectedOrg === organisation.slug ? "primary" : "secondary"}
            >
              {organisation.name}
            </ButtonLink>
          ))}
        </nav>
      ) : null}

      {!allCalls.length && role === "admin" ? (
        <Note>Este hospital no tiene llamadas en el periodo. El registro actual es de Clínica Arenal.</Note>
      ) : null}

      <nav aria-label="Quién atendió la llamada" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(Object.keys(LINE_LABEL) as LineFilter[]).map((key) => (
          <ButtonLink
            key={key}
            href={lineHref(key, selectedOrg)}
            current={line === key}
            size="sm"
            variant={line === key ? "primary" : "secondary"}
          >
            {LINE_LABEL[key]} · {num(filterLine(allCalls, key).length)}
          </ButtonLink>
        ))}
      </nav>
      <Note>
        {line === "all"
          ? "El agente atiende la línea. La central son las llamadas que pasaron a una persona."
          : `Mostrando ${LINE_LABEL[line].toLowerCase()}.`}
      </Note>
      {!directory.available ? <Note>No se pudo consultar el directorio de centros. Las sedes se muestran por su identificador.</Note> : null}

      <StatGrid>
        <StatCard
          emphasis
          href={lineHref(line, selectedOrg, true)}
          label="Efecto económico"
          value={euro(economics.effect)}
          icon="dashboard"
          delta={{ label: `${range.days} días`, tone: "neutral" }}
          hint="Toca para ver de dónde sale"
        />
        <StatCard
          label="Llamadas registradas"
          value={num(p.calls)}
          icon="phone"
          delta={{ label: LINE_LABEL[line], tone: "neutral" }}
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
          label="Pasadas a central"
          value={num(p.esc)}
          icon="phone"
          delta={{ label: `${pct(p.esc, p.calls)} %`, tone: p.esc ? "warning" : "success" }}
          hint="una persona del equipo las atendió"
        />
      </StatGrid>

      {analysis ? (
        <Card
          title="De dónde sale el efecto"
          description={`${num(economics.citas)} citas a ${euro(VALUE_RATES.visitEuro)} y ${hours(economics.agentMinutes)} de agente a ${euro(VALUE_RATES.deskHourEuro)}/h.`}
          actions={<ButtonLink href={lineHref(line, selectedOrg)} variant="secondary" size="sm">Cerrar</ButtonLink>}
        >
          <KeyValues items={[
            ["Citas × tarifa", `${num(economics.citas)} × ${euro(VALUE_RATES.visitEuro)} = ${euro(economics.agenda)}`],
            ["Horas que no ocupó la central", `${hours(economics.agentMinutes)} × ${euro(VALUE_RATES.deskHourEuro)} = ${euro(economics.savedLabor)}`],
            ["Horas en personas", `${hours(economics.deskMinutes)} = ${euro(economics.deskLabor)}`],
            ["Total", euro(economics.effect)],
          ]} />
          <Note>
            Las {num(open.open)} sin cierre no entran: no hubo reserva ni alta.
            {open.unfinished ? ` ${num(open.unfinished)} buscaron y no confirmaron.` : ""}
            {open.noTools ? ` ${num(open.noTools)} hablaron sin herramienta.` : ""}
            {open.short ? ` ${num(open.short)} duraron menos de 30 s.` : ""}
            {" "}
            <Link href={selectedOrg ? `/panel/llamadas?org=${selectedOrg}&resultado=sin_cierre` : "/panel/llamadas?resultado=sin_cierre"}>Verlas en Llamadas</Link>
          </Note>
        </Card>
      ) : null}

      {role === "admin" ? <AgentFleet /> : null}

      <Grid2>
        <Card
          title="Resultado de las llamadas"
          description="Resultado registrado por el agente; incluye llamadas sin cierre"
          actions={<Badge tone="neutral">{num(p.calls)} llamadas</Badge>}
        >
          {outcomes.length ? <BarList rows={outcomes} /> : <Note>No hay llamadas de esta línea en el periodo.</Note>}
        </Card>
        <Card
          title="Motivos registrados"
          description="Clasificación registrada por el agente, sin inferir especialidades"
          actions={<Badge tone="neutral">Top {consultations.length}</Badge>}
        >
          {consultations.length ? <BarList rows={consultations} /> : <Note>Sin motivos clasificados todavía.</Note>}
        </Card>
      </Grid2>

      {siteRows.length ? (
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
      ) : null}

      <Grid2>
        <Card
          title="Cierres de la línea"
          description={`Altas, cambios y llamadas que no llegaron a un resultado en estos ${range.days} días.`}
        >
          <KeyValues items={[
            ["Altas de paciente", num(p.altas)],
            ["Citas canceladas", num(calls.filter((call) => call.outcome === "cancelacion").length)],
            ["Citas cambiadas", num(calls.filter((call) => call.outcome === "cambio").length)],
            ["Sin cierre", num(p.unresolved)],
          ]} />
          {p.unresolved ? (
            <Note>
              Colgaron o no se llegó a reservar. No cuentan en el efecto.
              {" "}
              <Link href={selectedOrg ? `/panel/llamadas?org=${selectedOrg}&resultado=sin_cierre` : "/panel/llamadas"}>Ver en Llamadas</Link>
            </Note>
          ) : null}
        </Card>
        <Card
          title="Quién sostuvo la línea"
          description="El agente resolvió la mayoría. La central solo entra cuando hace falta una persona."
        >
          <KeyValues items={[
            ["Atendidas por el agente", `${num(live.length - deskLive)} · ${hours(economics.agentMinutes)}`],
            ["Atendidas por la central", `${num(deskLive)} · ${hours(economics.deskMinutes)}`],
            ["Valor de las citas", euro(economics.agenda)],
            ["Horas de central evitadas", hours(economics.agentMinutes)],
          ]} />
          <Note>
            {euro(VALUE_RATES.visitEuro)} la consulta, {euro(VALUE_RATES.deskHourEuro)} la hora de central. Referencia, no factura.
          </Note>
        </Card>
      </Grid2>
    </>
  );
}

function OrganisationOverview({
  organisations,
  range,
  analysis,
}: {
  organisations: Array<{ organisation: Organisation; calls: LoggedCall[] }>;
  range: { from: string; to: string; days: number };
  analysis: boolean;
}) {
  const rows = organisations
    .map(({ organisation, calls: allCalls }) => {
      const live = lineCalls(allCalls);
      return { organisation, live, metrics: callCounts(live), economics: periodEconomics(live) };
    })
    .sort((a, b) => b.economics.effect - a.economics.effect || b.metrics.calls - a.metrics.calls);
  const live = organisations.flatMap((item) => lineCalls(item.calls));
  const total = callCounts(live);
  const economics = periodEconomics(live);
  const open = openBreakdown(live);
  const active = rows.filter((row) => row.metrics.calls > 0);

  return (
    <>
      <PageHeader
        title="Resumen"
        description={`Efecto en la agenda de los clientes, ${range.days} días. Ahora mismo el registro es de Clínica Arenal.`}
        actions={
          <>
            <Badge tone="neutral">
              <Calendar size={12} aria-hidden="true" />
              {range.days} días · {periodLabel(range.from, range.to)}
            </Badge>
            <ButtonLink href="/panel/pruebas" variant="secondary" size="sm" icon={Radio}>
              Ver en tiempo real
            </ButtonLink>
          </>
        }
      />

      <StatGrid>
        <StatCard
          emphasis
          href={lineHref("all", undefined, true)}
          label="Generado con los clientes"
          value={euro(economics.effect)}
          icon="dashboard"
          delta={{ label: `${range.days} días`, tone: "neutral" }}
          hint={active.length === 1 ? active[0]!.organisation.name : `${num(active.length)} con llamadas`}
        />
        <StatCard
          label="Citas reservadas"
          value={num(economics.citas)}
          icon="dashboard"
          hint={`${euro(VALUE_RATES.visitEuro)} la consulta`}
        />
        <StatCard label="Llamadas registradas" value={num(total.calls)} icon="phone" hint={periodLabel(range.from, range.to)} />
        <StatCard label="Pasadas a una persona" value={num(total.esc)} icon="phone" hint={`${pct(total.esc, total.calls)} %`} />
      </StatGrid>

      {analysis ? (
        <Card
          title="De dónde sale el efecto"
          description={`${num(economics.citas)} citas a ${euro(VALUE_RATES.visitEuro)} y ${hours(economics.agentMinutes)} de agente a ${euro(VALUE_RATES.deskHourEuro)}/h.`}
          actions={<ButtonLink href="/panel" variant="secondary" size="sm">Cerrar</ButtonLink>}
        >
          <KeyValues items={[
            ["Citas × tarifa", `${num(economics.citas)} × ${euro(VALUE_RATES.visitEuro)} = ${euro(economics.agenda)}`],
            ["Horas que no ocupó la central", `${hours(economics.agentMinutes)} × ${euro(VALUE_RATES.deskHourEuro)} = ${euro(economics.savedLabor)}`],
            ["Horas en personas", `${hours(economics.deskMinutes)} = ${euro(economics.deskLabor)}`],
            ["Total", euro(economics.effect)],
          ]} />
          <Note>
            Las {num(open.open)} sin cierre no entran: no hubo reserva ni alta.
            {" "}
            En este periodo el registro es de Clínica Arenal.
            {" "}
            <Link href="/panel/llamadas">Verlas en Llamadas</Link>
          </Note>
        </Card>
      ) : null}

      <Card
        flush
        title="Clientes"
        description="Efecto por hospital. Quirón y Sanitas están dados de alta; todavía no tienen llamadas."
        actions={<Badge tone="neutral">{num(active.length)} con registro</Badge>}
      >
        <DataTable
          unit="clientes"
          columns={[
            { key: "cliente", header: "Cliente", width: "36%" },
            { key: "efecto", header: "Efecto", align: "right" },
            { key: "citas", header: "Citas", align: "right" },
            { key: "llamadas", header: "Llamadas", align: "right" },
            { key: "abrir", header: "", align: "right" },
          ]}
          rows={rows.map(({ organisation, metrics, economics: orgEconomics }) => ({
            id: organisation.slug,
            cells: [
              <Entity
                key="e"
                name={organisation.name}
                meta={metrics.calls
                  ? (organisation.sites.length ? `${organisation.sites.length} centros` : "Sin sedes en directorio")
                  : "Sin llamadas todavía"}
                initials={organisation.initials}
                tint={organisation.tint}
                square
              />,
              metrics.calls ? euro(orgEconomics.effect) : "—",
              metrics.calls ? num(metrics.citas) : "—",
              metrics.calls ? num(metrics.calls) : "—",
              <ButtonLink key="open" href={lineHref("all", organisation.slug)} size="sm" variant="secondary" icon={ArrowRight}>
                Ver hospital
              </ButtonLink>,
            ],
          }))}
        />
      </Card>
    </>
  );
}
