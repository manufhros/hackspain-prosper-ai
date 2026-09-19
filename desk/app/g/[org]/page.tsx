import { euro, num } from "@/lib/format";
import { orgScope } from "@/lib/org-scope";
import { pitch, SALES } from "@/lib/sales";
import { HOSPITALS } from "@/lib/hospitals";
import { byConsultation, filterSite, lineMinutes, qualityMetrics } from "@/lib/metrics";
import styles from "./dashboard.module.css";

export default async function GroupHoy({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, calls } = await orgScope(slug);
  const p = pitch(calls);
  const sites = HOSPITALS.filter((h) => h.orgSlug === slug);
  const rows = sites
    .map((hospital) => {
      const siteCalls = filterSite(calls, hospital.siteId);
      const metrics = pitch(siteCalls);
      const costYear = lineMinutes(siteCalls) * SALES.agentMinute * SALES.days;
      return {
        hospital,
        metrics,
        calls: siteCalls.length,
        costYear,
        netYear: metrics.agendaYear - costYear,
      };
    })
    .sort((a, b) => b.netYear - a.netYear);
  const maxCalls = Math.max(...rows.map((row) => row.calls), 1);
  const totalMinutes = lineMinutes(calls);
  const agentCostYear = totalMinutes * SALES.agentMinute * SALES.days;
  const autonomous = p.calls ? Math.round(((p.calls - p.esc) / p.calls) * 100) : 0;
  const escalatedCalls = calls.filter((call) => call.outcome === "escalado");
  const escalationsWithReason = escalatedCalls.filter((call) => Boolean(call.reason)).length;
  const escalationTrace = escalatedCalls.length
    ? Math.round((escalationsWithReason / escalatedCalls.length) * 100)
    : 100;
  const mostCalls = [...rows].sort((a, b) => b.calls - a.calls)[0];
  const consultationMix = byConsultation(calls).slice(0, 6);
  const maxConsultations = Math.max(...consultationMix.map((item) => item.count), 1);
  const quality = qualityMetrics(calls);

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <p>Resumen del grupo · 19 septiembre</p>
          <h1>Buenos días, {org.name}</h1>
          <span>Así está funcionando la recepción de vuestros centros.</span>
        </div>
        {org.source === "demo" ? <div className={styles.demo}>Datos de demostración</div> : null}
      </header>

      <section className={styles.overview}>
        <article className={styles.mainMetric}>
          <div className={styles.metricHead}>
            <span>Citas cerradas</span>
            <em>Todos los centros</em>
          </div>
          <strong>{num(p.citas)}</strong>
          <p>{p.booked} % de las llamadas terminan con una cita en agenda.</p>
          <div className={styles.progress}><i style={{ width: `${p.booked}%` }} /></div>
        </article>

        <article className={styles.valueMetric}>
          <span>Valor anual estimado de las citas</span>
          <strong>{euro(p.agendaYear)}</strong>
          <p>Proyección comercial: 128 € por cita durante 220 días.</p>
          <a href={`/g/${slug}/ahorro`}>Ver cómo se calcula →</a>
        </article>
      </section>

      <section className={styles.metrics}>
        <article>
          <span>Coste anual del agente</span>
          <strong>{euro(agentCostYear)}</strong>
          <small>{SALES.agentMinute.toFixed(2).replace(".", ",")} €/min · hipótesis demo</small>
        </article>
        <article>
          <span>Resuelto sin mostrador</span>
          <strong>{autonomous} %</strong>
          <small>{num(p.calls - p.esc)} llamadas autónomas</small>
        </article>
        <article>
          <span>Escalados con trazabilidad</span>
          <strong>{escalationTrace} %</strong>
          <small>{num(p.esc)} llamadas con motivo y contexto</small>
        </article>
        <article>
          <span>Frustración media</span>
          <strong>{quality.frustration} / 100</strong>
          <small>Señales de repetición, errores y petición de persona</small>
        </article>
        <article>
          <span>Latencia de herramientas</span>
          <strong>{quality.avgLatencyMs == null ? "—" : `${quality.avgLatencyMs} ms`}</strong>
          <small>{quality.toolErrorRate} % de ejecuciones con error</small>
        </article>
        <article>
          <span>Valoración del paciente</span>
          <strong>{quality.patientRating == null ? "Sin encuesta" : `${quality.patientRating.toFixed(1)} / 5`}</strong>
          <small>No se infiere a partir del sentimiento</small>
        </article>
      </section>

      <section className={styles.consultations}>
        <header>
          <div>
            <h2>Consultas más recibidas</h2>
            <p>Motivo principal detectado durante la llamada.</p>
          </div>
          <span>Top {consultationMix.length}</span>
        </header>
        <div>
          {consultationMix.map((item, index) => (
            <article key={item.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.name}</strong>
              <div><i style={{ width: `${(item.count / maxConsultations) * 100}%` }} /></div>
              <b>{num(item.count)}</b>
              <small>{Math.round((item.count / p.calls) * 100)} %</small>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.insights}>
        <article>
          <header>
            <div>
              <h2>De dónde llegan las llamadas</h2>
              <p>Distribución del volumen entre centros.</p>
            </div>
            <span>{num(p.calls)} total</span>
          </header>
          <div className={styles.volumeList}>
            {[...rows].sort((a, b) => b.calls - a.calls).map(({ hospital, calls: siteCalls }) => (
              <div key={hospital.id}>
                <span>{hospital.name}</span>
                <div><i style={{ width: `${(siteCalls / maxCalls) * 100}%`, background: hospital.tint }} /></div>
                <strong>{num(siteCalls)}</strong>
              </div>
            ))}
          </div>
          {mostCalls ? (
            <p className={styles.insightNote}>
              <strong>{mostCalls.hospital.name}</strong> concentra el mayor volumen: {num(mostCalls.calls)} llamadas.
            </p>
          ) : null}
        </article>

        <article className={styles.quality}>
          <header>
            <div>
              <h2>Control de escalados</h2>
              <p>Lo que el equipo humano debe revisar.</p>
            </div>
          </header>
          <div className={styles.qualityScore}>
            <strong>{escalationTrace} %</strong>
            <span>llega con motivo registrado</span>
          </div>
          <dl>
            <div><dt>{num(p.esc)}</dt><dd>escalados</dd></div>
            <div><dt>{num(escalationsWithReason)}</dt><dd>con contexto</dd></div>
            <div><dt>{num(p.calls - p.esc)}</dt><dd>resueltos solos</dd></div>
          </dl>
          <p className={styles.insightNote}>La trazabilidad no prueba criterio clínico: permite auditarlo llamada a llamada.</p>
        </article>
      </section>

      <section className={styles.centers}>
        <header>
          <div>
            <h2>Rentabilidad por centro</h2>
            <p>Valor estimado de agenda menos coste de voz.</p>
          </div>
          <span>{sites.length} centros</span>
        </header>
        <div className={styles.centerList}>
          <div className={styles.listLabels}>
            <span>Centro</span><span>Distribución</span><span>Llamadas</span><span>Coste</span><span>Valor neto</span>
          </div>
          {rows.map(({ hospital, metrics, calls: siteCalls, costYear, netYear }, index) => (
            <div className={styles.centerRow} key={hospital.id}>
              <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.centerName}>
                <strong>{hospital.name}</strong>
                <small>{hospital.city}</small>
              </div>
              <div className={styles.bar} aria-hidden="true">
                <i style={{ width: `${(siteCalls / maxCalls) * 100}%`, background: hospital.tint }} />
              </div>
              <div className={styles.centerValue}>
                <strong>{num(siteCalls)}</strong>
                <small>{num(metrics.citas)} citas</small>
              </div>
              <div className={styles.centerCost}>
                <strong>{euro(costYear)}</strong>
                <small>coste anual</small>
              </div>
              <div className={styles.centerRevenue}>
                <strong>{euro(netYear)}</strong>
                <small>valor neto estimado</small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
