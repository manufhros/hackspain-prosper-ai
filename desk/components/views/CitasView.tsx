import { Motive } from "@/components/Motive";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge, Card, Entity, OutcomeBadge, PageHeader, StatCard, StatGrid } from "@/components/ui/primitives";
import { euro, num, slotLabel, timeOf } from "@/lib/format";
import { pitch } from "@/lib/sales";
import { scopeCrumbs, type ViewScope } from "./scope";

export function CitasView({ scope }: { scope: ViewScope }) {
  const { calls, org } = scope;
  const p = pitch(calls);
  const rows = calls.filter((call) => call.outcome === "cita" || call.outcome === "cambio");
  const multiSite = scope.kind === "org" && scope.sites.length > 1;
  const privacyKey = scope.hospital?.id ?? org.slug;

  const columns: Column[] = [
    { key: "hora", header: "Hora", nowrap: true, width: "72px" },
    { key: "paciente", header: "Paciente", width: "22%" },
    ...(multiSite ? [{ key: "centro", header: "Centro", nowrap: true } as Column] : []),
    { key: "motivo", header: "Motivo" },
    { key: "hueco", header: "Hueco", nowrap: true },
    { key: "estado", header: "Estado", nowrap: true },
  ];

  return (
    <>
      <PageHeader
        crumbs={scopeCrumbs(scope, "Citas")}
        title="Citas reservadas"
        description={`${num(p.citas)} citas cerradas hoy por el agente · ${euro(p.agendaDay)} de agenda · ${euro(p.agendaYear)} proyectados al año.`}
      />

      <StatGrid>
        <StatCard label="Citas hoy" value={num(p.citas)} icon="calendar" delta={{ label: `${p.booked} %` }} hint="de las llamadas" />
        <StatCard label="Agenda captada hoy" value={euro(p.agendaDay)} icon="business" delta={{ label: "128 €", tone: "success" }} hint="ticket medio" />
        <StatCard
          label="Cambios de hora"
          value={num(calls.filter((call) => call.outcome === "cambio").length)}
          icon="activity"
          hint="gestionados sin persona"
        />
      </StatGrid>

      <Card flush>
        <DataTable
          unit="citas"
          columns={columns}
          tabs={multiSite ? scope.sites.map((site) => ({ value: site.siteId, label: site.name })) : undefined}
          searchPlaceholder="Buscar paciente o motivo…"
          emptyTitle="Sin citas todavía"
          emptyDescription="Cuando el agente cierre una cita aparecerá aquí con su hueco y motivo."
          rows={rows.map((call) => ({
            id: call.id,
            tab: call.site ?? undefined,
            search: `${call.patient ?? ""} ${call.motive} ${call.siteName} ${call.insurer ?? ""}`.toLowerCase(),
            cells: [
              timeOf(call.started),
              <Entity
                key="p"
                name={call.patient ?? "Paciente sin identificar"}
                anon={!call.patient}
                meta={call.insurer ? call.insurer : call.phone ? "Teléfono verificado" : "Sin ficha en el log"}
              />,
              ...(multiSite ? [call.siteName] : []),
              <Motive key="m" org={privacyKey} text={call.motive} live={scope.live} />,
              call.slot ? <strong key="s">{slotLabel(call.slot)}</strong> : <Badge tone="neutral">Sin hueco</Badge>,
              <OutcomeBadge key="o" outcome={call.outcome} />,
            ],
          }))}
        />
      </Card>
    </>
  );
}
