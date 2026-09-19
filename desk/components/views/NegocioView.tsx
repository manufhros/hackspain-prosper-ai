import { DataTable } from "@/components/ui/DataTable";
import { Card, Grid2, KeyValues, Note, PageHeader, StatCard, StatGrid } from "@/components/ui/primitives";
import { euro, num } from "@/lib/format";
import { pitch, SALES } from "@/lib/sales";
import { scopeCrumbs, scopeName, type ViewScope } from "./scope";

export function NegocioView({ scope }: { scope: ViewScope }) {
  const p = pitch(scope.calls);
  const total = p.agendaYear + p.deskYear;

  return (
    <>
      <PageHeader
        crumbs={scopeCrumbs(scope, "Negocio")}
        eyebrow="Proyección comercial"
        title={euro(total)}
        description={`${scopeName(scope)} · agenda llena más admisión que no contratáis · ${SALES.days} jornadas al ritmo de hoy.`}
      />

      <StatGrid>
        <StatCard label="Huecos cobrados" value={euro(p.agendaYear)} icon="calendar" emphasis hint={`${num(p.citas)} citas · ${SALES.ticket} € de ticket`} />
        <StatCard label="Admisión no contratada" value={euro(p.deskYear)} icon="patients" delta={{ label: `${p.ftes.toFixed(1)} FTE`, tone: "info" }} hint="turnos que no abrís" />
        <StatCard label="Que no se escapa al buzón" value={euro(p.missedYear)} icon="phone" delta={{ label: `${Math.round(SALES.missedWithout * 100)} %`, tone: "warning" }} hint="llamadas perdidas sin línea" />
        <StatCard label="Llamadas que acaban en cita" value={`${p.booked} %`} icon="activity" hint={`${num(p.citas)} de ${num(p.calls)} llamadas`} />
      </StatGrid>

      <Grid2>
        <Card flush title="Mostrador solo frente a hash" description="Mismo volumen de llamadas, dos formas de atenderlo">
          <DataTable
            columns={[
              { key: "concepto", header: "Concepto" },
              { key: "solo", header: "Mostrador solo", align: "right" },
              { key: "hash", header: "Con hash", align: "right" },
            ]}
            rows={[
              {
                id: "agenda",
                cells: ["Agenda al año", <span key="a" className="muted">{euro(p.agendaYear * (1 - SALES.missedWithout))}</span>, <strong key="b">{euro(p.agendaYear)}</strong>],
              },
              {
                id: "personal",
                cells: ["Personal de admisión", <span key="a" className="muted">+{p.ftes.toFixed(1)} FTE</span>, <strong key="b">0 extra</strong>],
              },
              {
                id: "perdidas",
                cells: ["Llamadas perdidas", <span key="a" className="muted">{Math.round(SALES.missedWithout * 100)} %</span>, <strong key="b">{num(p.esc)} a persona</strong>],
              },
              {
                id: "horario",
                cells: ["Horario de atención", <span key="a" className="muted">Turnos de mostrador</span>, <strong key="b">24 / 7</strong>],
              },
            ]}
          />
        </Card>

        <Card title="Hipótesis del cálculo" description="Parámetros comerciales; no salen del log de llamadas">
          <KeyValues
            items={[
              ["Ticket medio por cita", `${SALES.ticket} €`],
              ["Valor paciente nuevo, año 1", `${SALES.newPatient} €`],
              ["Coste hora de admisión", `${SALES.hour} €`],
              ["Minutos por llamada atendida a mano", `${SALES.minutes} min`],
              ["Jornadas al año", `${SALES.days}`],
              ["Coste anual de un FTE", euro(SALES.fteYear)],
              ["Llamadas perdidas sin línea", `${Math.round(SALES.missedWithout * 100)} %`],
              ["Coste del agente por minuto", `${SALES.agentMinute.toFixed(2).replace(".", ",")} €`],
            ]}
          />
        </Card>
      </Grid2>

      <Note>
        <strong>Cómo leerlo.</strong> Las cifras proyectan el ritmo de hoy a un año. Sirven para dimensionar el impacto, no como
        previsión contable.
      </Note>
    </>
  );
}
