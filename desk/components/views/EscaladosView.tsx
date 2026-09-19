import { Motive } from "@/components/Motive";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge, Card, Note, OutcomeBadge, PageHeader, StatCard, StatGrid } from "@/components/ui/primitives";
import { num, pct, timeOf } from "@/lib/format";
import { pitch } from "@/lib/sales";
import { scopeCrumbs, type ViewScope } from "./scope";

const REASON_LABEL: Record<string, string> = {
  medical_emergency: "Urgencia médica",
  human_requested: "Pidió una persona",
  frustration: "Frustración alta",
  tool_failure: "Fallo de herramienta",
  out_of_scope: "Fuera de alcance",
  no_availability: "Sin disponibilidad",
  policy: "Norma del centro",
};

function reasonLabel(reason: string | null) {
  if (!reason) return null;
  return REASON_LABEL[reason] ?? reason.replaceAll("_", " ");
}

export function EscaladosView({ scope }: { scope: ViewScope }) {
  const { calls, org } = scope;
  const p = pitch(calls);
  const rows = calls.filter((call) => call.outcome === "escalado" || call.outcome === "sin_cita");
  const escalated = rows.filter((call) => call.outcome === "escalado");
  const withReason = escalated.filter((call) => Boolean(call.reason)).length;
  const multiSite = scope.kind === "org" && scope.sites.length > 1;
  const privacyKey = scope.hospital?.id ?? org.slug;

  const columns: Column[] = [
    { key: "hora", header: "Hora", nowrap: true, width: "72px" },
    ...(multiSite ? [{ key: "centro", header: "Centro", nowrap: true } as Column] : []),
    { key: "tipo", header: "Tipo", nowrap: true },
    { key: "motivo", header: "Motivo de escalado", nowrap: true },
    { key: "llamada", header: "Lo que dijo el paciente" },
    { key: "frustracion", header: "Frustración", align: "right", nowrap: true },
  ];

  return (
    <>
      <PageHeader
        crumbs={scopeCrumbs(scope, "Escalados")}
        title={`${p.kept} % resuelto sin mostrador`}
        description={`${num(rows.length)} llamadas necesitaron una persona o cerraron sin cita. El resto lo resolvió el agente.`}
      />

      <StatGrid>
        <StatCard
          label="Pasadas a persona"
          value={num(p.esc)}
          icon="escalation"
          delta={{ label: `${pct(p.esc, p.calls)} %`, tone: "danger" }}
          hint="de las llamadas"
        />
        <StatCard
          label="Con motivo registrado"
          value={escalated.length ? `${pct(withReason, escalated.length)} %` : "—"}
          icon="shield"
          delta={{ label: num(withReason), tone: "success" }}
          hint="escalados trazables"
        />
        <StatCard
          label="Cerradas sin cita"
          value={num(rows.length - escalated.length)}
          icon="calendar"
          hint="por norma del centro o falta de hueco"
        />
      </StatGrid>

      <Card flush>
        <DataTable
          unit="llamadas"
          columns={columns}
          tabs={[
            { value: "escalado", label: "Escalados" },
            { value: "sin_cita", label: "Sin cita" },
          ]}
          searchPlaceholder="Buscar motivo o centro…"
          emptyTitle="Nada que revisar"
          emptyDescription="Ninguna llamada ha necesitado una persona ni se ha cerrado sin cita."
          rows={rows.map((call) => ({
            id: call.id,
            tab: call.outcome,
            search: `${call.siteName} ${call.motive} ${call.reason ?? ""}`.toLowerCase(),
            cells: [
              timeOf(call.started),
              ...(multiSite ? [call.siteName] : []),
              <OutcomeBadge key="o" outcome={call.outcome} />,
              reasonLabel(call.reason) ?? <span className="muted">—</span>,
              <Motive key="m" org={privacyKey} text={call.motive} live={scope.live} />,
              call.frustrationScore == null ? (
                "—"
              ) : (
                <Badge key="f" tone={call.frustrationScore >= 50 ? "danger" : "neutral"}>
                  {call.frustrationScore} / 100
                </Badge>
              ),
            ],
          }))}
        />
      </Card>

      <Note>
        <strong>La trazabilidad no sustituye al criterio clínico.</strong> Permite auditar cada escalado: quién llamó, qué pidió y por
        qué el agente pasó la llamada.
      </Note>
    </>
  );
}
