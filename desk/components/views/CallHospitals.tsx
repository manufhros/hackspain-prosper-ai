import { ArrowRight, Radio } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { Badge, ButtonLink, Card, Entity, PageHeader, StatCard, StatGrid } from "@/components/ui/primitives";
import { num, periodLabel } from "@/lib/format";
import type { Organisation } from "@/lib/orgs";
import { callCounts, lineCalls } from "@/lib/reporting";
import type { LoggedCall } from "@/lib/types";

export function CallHospitals({
  summaries,
  range,
  liveHref,
}: {
  summaries: Array<{ organisation: Organisation; calls: LoggedCall[] }>;
  range: { from: string; to: string; days: number };
  liveHref?: string;
}) {
  const rows = summaries
    .map(({ organisation, calls }) => {
      const live = lineCalls(calls);
      return { organisation, metrics: callCounts(live) };
    })
    .sort((a, b) => b.metrics.calls - a.metrics.calls);
  const total = rows.reduce((sum, row) => sum + row.metrics.calls, 0);
  const active = rows.filter((row) => row.metrics.calls > 0);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Resumen", href: "/panel" }, { label: "Llamadas" }]}
        title="Llamadas"
        description={`Por hospital, ${range.days} días. Ahora mismo el registro es de Clínica Arenal.`}
        actions={
          <>
            <Badge tone="neutral">{range.days} días · {periodLabel(range.from, range.to)}</Badge>
            {liveHref ? (
              <ButtonLink href={liveHref} variant="secondary" size="sm" icon={Radio}>
                Ver en tiempo real
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Llamadas registradas"
          value={num(total)}
          icon="phone"
          hint={active.length === 1 ? active[0]!.organisation.name : `${num(active.length)} con registro`}
        />
        <StatCard
          label="Citas reservadas"
          value={num(rows.reduce((sum, row) => sum + row.metrics.citas, 0))}
          icon="dashboard"
          hint="de todos los hospitales"
        />
        <StatCard
          label="Pasadas a una persona"
          value={num(rows.reduce((sum, row) => sum + row.metrics.esc, 0))}
          icon="phone"
        />
        <StatCard
          label="Hospitales"
          value={num(rows.length)}
          icon="dashboard"
          hint={`${num(active.length)} con llamadas`}
        />
      </StatGrid>

      <Card
        flush
        title="Hospitales"
        description="Abre un hospital para ver sus llamadas. Quirón y Sanitas están dados de alta; todavía no tienen registro."
        actions={<Badge tone="neutral">{num(active.length)} con registro</Badge>}
      >
        <DataTable
          unit="hospitales"
          columns={[
            { key: "hospital", header: "Hospital", width: "40%" },
            { key: "llamadas", header: "Llamadas", align: "right" },
            { key: "citas", header: "Citas", align: "right" },
            { key: "esc", header: "A persona", align: "right" },
            { key: "abrir", header: "", align: "right" },
          ]}
          rows={rows.map(({ organisation, metrics }) => ({
            id: organisation.slug,
            cells: [
              <Entity
                key="e"
                name={organisation.name}
                meta={metrics.calls
                  ? (organisation.sites.length ? `${organisation.sites.length} centros` : `${num(metrics.calls)} llamadas`)
                  : "Sin llamadas todavía"}
                initials={organisation.initials}
                tint={organisation.tint}
                square
              />,
              metrics.calls ? num(metrics.calls) : "—",
              metrics.calls ? num(metrics.citas) : "—",
              metrics.calls ? num(metrics.esc) : "—",
              <ButtonLink
                key="open"
                href={`/panel/llamadas?org=${organisation.slug}`}
                size="sm"
                variant="secondary"
                icon={ArrowRight}
              >
                Ver llamadas
              </ButtonLink>,
            ],
          }))}
        />
      </Card>
    </>
  );
}
