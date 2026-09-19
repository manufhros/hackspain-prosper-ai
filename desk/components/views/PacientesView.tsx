import { DataTable } from "@/components/ui/DataTable";
import { Badge, Card, Entity, PageHeader, StatCard, StatGrid } from "@/components/ui/primitives";
import { euro, num, timeOf } from "@/lib/format";
import { patientsFrom } from "@/lib/metrics";
import { pitch, SALES } from "@/lib/sales";
import { scopeCrumbs, type ViewScope } from "./scope";

const INSURER_LABEL: Record<string, string> = {
  sanitas: "Sanitas",
  adeslas: "Adeslas",
  dkv: "DKV",
  mapfre: "Mapfre",
  asisa: "ASISA",
  caser: "Caser",
  cigna: "Cigna",
  axa: "AXA",
};

export function PacientesView({ scope }: { scope: ViewScope }) {
  const { calls } = scope;
  const p = pitch(calls);
  const people = patientsFrom(calls);
  const identified = people.filter((row) => !row.name.startsWith("Sin identificar"));

  return (
    <>
      <PageHeader
        crumbs={scopeCrumbs(scope, "Pacientes")}
        title={`${num(p.altas)} altas de paciente`}
        description={`Cartera nueva captada por teléfono. Primer año estimado: ${euro(p.pipelineYear)} a ${SALES.newPatient} € por paciente.`}
      />

      <StatGrid>
        <StatCard label="Altas hoy" value={num(p.altas)} icon="patients" delta={{ label: "Nuevos", tone: "info" }} hint="pacientes registrados" />
        <StatCard label="Pacientes identificados" value={num(identified.length)} icon="shield" hint="con ficha localizada durante la llamada" />
        <StatCard label="Cartera año 1" value={euro(p.pipelineYear)} icon="business" delta={{ label: `${SALES.newPatient} €`, tone: "success" }} hint="por paciente nuevo" />
      </StatGrid>

      <Card flush>
        <DataTable
          unit="pacientes"
          columns={[
            { key: "paciente", header: "Paciente", width: "34%" },
            { key: "mutua", header: "Mutua", nowrap: true },
            { key: "llamadas", header: "Llamadas", align: "right", nowrap: true },
            { key: "ultima", header: "Última llamada", align: "right", nowrap: true },
          ]}
          searchPlaceholder="Buscar paciente o mutua…"
          emptyTitle="Sin pacientes todavía"
          emptyDescription="Los pacientes identificados o dados de alta por el agente aparecerán aquí."
          rows={people.map((row, index) => {
            const anon = row.name.startsWith("Sin identificar");
            return {
              id: `${row.name}-${index}`,
              search: `${row.name} ${row.insurer ?? ""}`.toLowerCase(),
              cells: [
                <Entity key="p" name={anon ? "Paciente sin identificar" : row.name} anon={anon} meta={anon ? "Sin ficha en el log" : "Ficha localizada"} />,
                row.insurer ? <Badge key="i" tone="neutral">{INSURER_LABEL[row.insurer] ?? row.insurer}</Badge> : <span className="muted">—</span>,
                num(row.calls),
                timeOf(row.last),
              ],
            };
          })}
        />
      </Card>
    </>
  );
}
