import { clinicDirectory } from "@/lib/clinic-catalog";
import { ORIGIN_LABEL } from "@/lib/reporting";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { CallRefresh } from "@/components/CallRefresh";
import { Badge, ButtonLink, Card, Note, OutcomeBadge, PageHeader } from "@/components/ui/primitives";
import { canOpen, homeFor } from "@/lib/auth";
import { adminCall, clinicCall } from "@/lib/call-data";
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
  const pageNumber = typeof turnPage === "string" ? Number(turnPage) : 1;
  const detail = session.role === "admin"
    ? await adminCall(callId, pageNumber)
    : await clinicCall(callId, pageNumber);
  if (!detail) notFound();
  const directory = await clinicDirectory();
  const { call, transcript, transcriptTotal, page, pages } = detail;
  const href = `/panel/llamadas/${encodeURIComponent(call.id)}`;
  const reason = reasonLabel(call.reason);
  return (
    <>
      <CallRefresh />
      <PageHeader
        title={call.patient || "Detalle de llamada"}
        description={`${slotLabel(call.started)} · ${siteOf(call.site, directory.sites).name}`}
        crumbs={[
          { label: CLINIC.name, href: homeFor(session) },
          { label: "Llamadas", href: "/panel/llamadas" },
          { label: "Detalle" },
        ]}
        actions={<>
          <ButtonLink href="#herramientas" variant="secondary">Ver herramientas</ButtonLink>
          <ButtonLink href="/panel/llamadas" variant="secondary" icon={ArrowLeft}>Volver a llamadas</ButtonLink>
        </>}
      />
      <Card title="Resumen de la llamada" actions={<OutcomeBadge outcome={call.outcome} />}>
        <dl className={styles.facts}>
          <div><dt>Duración</dt><dd>{call.minutes != null ? `${num(call.minutes * 60)} s` : "No disponible"}</dd></div>
          <div><dt>Origen</dt><dd>{ORIGIN_LABEL[call.origin ?? "unknown"]}</dd></div>
          <div><dt>Motivo</dt><dd>{reason || call.motive || "No registrado"}</dd></div>
          <div><dt>Acciones del agente</dt><dd>{num(Math.max(call.actions?.length ?? 0, call.toolCalls ?? 0))}</dd></div>
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
      <section id="herramientas" aria-label="Herramientas de la llamada">
      <Card title="Herramientas de la llamada" description="Consultas y acciones en orden cronológico. Abre cada una para ver sus datos."
        actions={<Badge>{num(call.actions?.length ?? 0)} registradas</Badge>}>
        {call.actions?.length ? (
          <ol className={styles.transcript} aria-label="Herramientas de la llamada">
            {call.actions.map((action, index) => (
              <li key={action.id ?? `${action.name}-${index}`} className={styles.tool}>
                <details>
                  <summary>
                    <span className={styles.toolHeading}>
                      <strong>{TOOL_LABEL[action.name] ?? action.name}</strong>
                      <span>{action.at ? slotLabel(action.at) : "Hora no disponible"}</span>
                    </span>
                    <Badge tone={action.status === "failed" ? "danger" : action.status === "blocked" ? "warning" : "neutral"}>
                      {action.summary}
                    </Badge>
                  </summary>
                  <div className={styles.toolContent}>
                    <p className={styles.identifier}>{action.name}{action.latencyMs != null ? ` · ${num(action.latencyMs)} ms` : ""}</p>
                    {action.reason ? <p>{reasonLabel(action.reason) ?? action.reason}</p> : null}
                    <h3>Parámetros</h3>
                    {action.parameters != null ? <pre>{JSON.stringify(action.parameters, null, 2)}</pre> : <p>No se conservaron los parámetros.</p>}
                    <h3>Resultado</h3>
                    {action.result != null ? <pre>{JSON.stringify(action.result, null, 2)}</pre> : <p>No se conservó el resultado completo.</p>}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        ) : <Note>{call.toolCalls
          ? "La llamada registra acciones, pero no se conservó su detalle."
          : "No hay herramientas registradas para esta llamada."}</Note>}
      </Card>
      </section>
    </>
  );
}
