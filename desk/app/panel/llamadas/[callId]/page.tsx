import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { CallRefresh } from "@/components/CallRefresh";
import { Badge, ButtonLink, Card, Note, OutcomeBadge, PageHeader } from "@/components/ui/primitives";
import { canOpen, homeFor } from "@/lib/auth";
import { clinicCall } from "@/lib/call-data";
import { CLINIC, siteOf } from "@/lib/clinic";
import { num, slotLabel } from "@/lib/format";
import { reasonLabel, TOOL_LABEL } from "@/lib/labels";
import { getSession } from "@/lib/session";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Detalle de llamada · Admisión" };

export default async function CallPage({ params, searchParams }: {
  params: Promise<{ callId: string }>;
  searchParams: Promise<{ turnPage?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/llamadas")) redirect(homeFor(session));
  const { callId } = await params;
  const { turnPage } = await searchParams;
  const detail = await clinicCall(callId, typeof turnPage === "string" ? Number(turnPage) : 1);
  if (!detail) notFound();
  const { call, transcript, transcriptTotal, page, pages } = detail;
  const href = `/panel/llamadas/${encodeURIComponent(call.id)}`;
  const reason = reasonLabel(call.reason);
  return (
    <>
      <CallRefresh />
      <PageHeader
        title={call.patient || "Detalle de llamada"}
        description={`${slotLabel(call.started)} · ${siteOf(call.site).name}`}
        crumbs={[
          { label: CLINIC.name, href: homeFor(session) },
          { label: "Llamadas", href: "/panel/llamadas" },
          { label: "Detalle" },
        ]}
        actions={<ButtonLink href="/panel/llamadas" variant="secondary" icon={ArrowLeft}>Volver a llamadas</ButtonLink>}
      />
      <Card title="Resumen de la llamada" actions={<OutcomeBadge outcome={call.outcome} />}>
        <dl className={styles.facts}>
          <div><dt>Duración</dt><dd>{call.minutes ? `${num(call.minutes * 60)} s` : "No disponible"}</dd></div>
          <div><dt>Motivo</dt><dd>{reason || call.motive || "No registrado"}</dd></div>
          <div><dt>Acciones del agente</dt><dd>{num(call.actions?.length ?? call.toolCalls ?? 0)}</dd></div>
          <div><dt>Identificador</dt><dd className={styles.identifier}>{call.id}</dd></div>
          <div><dt>Versión del agente</dt><dd className={styles.identifier}>{call.configVersion || "No registrada"}</dd></div>
          {call.slot ? <div><dt>Cita</dt><dd>{slotLabel(call.slot)}</dd></div> : null}
        </dl>
      </Card>
      <Card title="Transcripción" description="Conversación en orden cronológico. Horas de Madrid."
        actions={<Badge>{num(transcriptTotal)} intervenciones</Badge>}>
        {transcript.length ? (
          <ol className={styles.transcript} aria-label="Transcripción de la llamada">
            {transcript.map((entry) => (
              <li key={entry.id} className={styles.turn} data-speaker={entry.speaker}>
                <div className={styles.speaker}>
                  <strong>{entry.speaker === "caller" ? "Llamante" : "Agente"}</strong>
                  <time dateTime={entry.at}>{new Intl.DateTimeFormat("es-ES", {
                    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Madrid",
                  }).format(new Date(entry.at))}</time>
                </div>
                <p>{entry.text}</p>
              </li>
            ))}
          </ol>
        ) : (
          <Note>{call.outcome === "en_curso"
            ? "Todavía no hay intervenciones guardadas. Aparecerán aquí en cuanto se reciban."
            : "No hay transcripción guardada para esta llamada. El texto que no se conservó en llamadas anteriores no se puede recuperar."}</Note>
        )}
        {pages > 1 ? (
          <nav className={styles.pagination} aria-label="Páginas de la transcripción">
            {page > 1 ? <ButtonLink variant="secondary" size="sm" href={`${href}?turnPage=${page - 1}`}>Anterior</ButtonLink> : <span />}
            <span>Página {page} de {pages}</span>
            {page < pages ? <ButtonLink variant="secondary" size="sm" href={`${href}?turnPage=${page + 1}`}>Siguiente</ButtonLink> : <span />}
          </nav>
        ) : null}
      </Card>
      {call.actions?.length ? (
        <Card title="Registro de decisiones">
          <ol className={styles.transcript}>
            {call.actions.map((action, index) => (
              <li className={styles.turn} key={`${action.name}-${index}`}>
                <div className={styles.speaker}>
                  <strong>{TOOL_LABEL[action.name] ?? action.name}</strong>
                  <small>{action.at ? slotLabel(action.at) : "Hora no disponible"}</small>
                </div>
                <p>{action.summary}{action.reason ? ` · ${reasonLabel(action.reason) ?? action.reason}` : ""}</p>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </>
  );
}
