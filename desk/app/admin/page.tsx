import { Logout } from "@/components/Logout";
import { Mark } from "@/components/Mark";
import { AgentControl } from "@/components/AgentControl";
import { AgentFleet } from "@/components/AgentFleet";
import { ROLE_LABEL, mailboxExamples, orgDomain } from "@/lib/auth";
import { euro, num } from "@/lib/format";
import { HOSPITALS } from "@/lib/hospitals";
import { ORGS, getOrg } from "@/lib/orgs";
import { filterSite, lineMinutes } from "@/lib/metrics";
import { callsForOrg } from "@/lib/call-data";
import { pitch, SALES } from "@/lib/sales";
import { getSession } from "@/lib/session";
import { readAgentConfigState } from "@/lib/agent-config";
import { redirect } from "next/navigation";
import styles from "./admin.module.css";

const GROUP_MARKS: Record<string, { initials: string; tint: string }> = {
  arenal: { initials: "A", tint: "#256554" },
  quironsalud: { initials: "Q+", tint: "#0089a6" },
  sanitas: { initials: "S", tint: "#007d8a" },
};

export default async function Admin() {
  const session = await getSession();
  if (session?.kind !== "hash") redirect("/");
  const agentConfig = await readAgentConfigState();
  const groups = await Promise.all(ORGS.map(async (org) => {
    const calls = await callsForOrg(org);
    return { org, calls, metrics: pitch(calls) };
  }));
  const totalCalls = groups.reduce((sum, group) => sum + group.calls.length, 0);
  const totalCitas = groups.reduce((sum, group) => sum + group.metrics.citas, 0);
  const agentCost = groups.reduce(
    (sum, group) => sum + lineMinutes(group.calls) * SALES.agentMinute * SALES.days,
    0,
  );

  return (
    <div className={styles.admin}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/admin"><span>h</span><strong>hash</strong></a>
        <div className={styles.user}>
          <span>LC</span>
          <div><strong>Lucía</strong><small>{session.email}</small></div>
        </div>
        <nav>
          <a className={styles.active} href="#resumen">Operación</a>
          <a href="#agentes">Agentes en vivo</a>
          <a href="/admin/llamadas">Llamadas y escalados</a>
          <a href="/admin/simulador">Probar agente</a>
          <a href="#agente">Configuración</a>
          <a href="#centros">Hospitales</a>
          <a href="#accesos">Accesos</a>
        </nav>
        <div className={styles.sidebarFoot}>
          <p><i /> Sistemas operativos</p>
          <Logout />
        </div>
      </aside>
      <main className={styles.content}>
        <header className={styles.header} id="resumen">
          <div>
            <h1>Operación</h1>
            <span>Agentes, llamadas, escalados y rendimiento de toda la red.</span>
          </div>
        </header>

        <section className={styles.kpis}>
          <article><span>Centros configurados</span><strong>{HOSPITALS.length}</strong><small>{ORGS.length} organizaciones</small></article>
          <article><span>Llamadas procesadas</span><strong>{num(totalCalls)}</strong><small>{num(totalCitas)} citas · real + demo</small></article>
          <article><span>Coste anual estimado</span><strong>{euro(agentCost)}</strong><small>Hipótesis sobre real + demo</small></article>
          <article><span>Conversión a cita</span><strong>{totalCalls ? Math.round((totalCitas / totalCalls) * 100) : 0} %</strong><small>Agregado real + demo</small></article>
        </section>

        <AgentFleet profiles={ORGS.map((org) => ({
          slug: org.slug,
          name: org.name,
          centers: org.hospitals.length,
        }))} />

        <section className={styles.groups}>
          <header><div><h2>Organizaciones</h2><p>Actividad agregada y origen de cada cuenta.</p></div></header>
          <div>
            {groups.map(({ org, calls, metrics }) => (
              <article key={org.slug}>
                <div className={styles.groupTop}>
                  <Mark
                    initials={GROUP_MARKS[org.slug]?.initials ?? org.name.slice(0, 1)}
                    tint={GROUP_MARKS[org.slug]?.tint ?? "#0b3b49"}
                  />
                  <div><strong>{org.name}</strong><small>{org.hospitals.length} centros · {orgDomain(org.slug)}</small></div>
                  <span className={org.source === "llamadas" ? styles.real : styles.demo}>{org.source === "llamadas" ? "Logs reales" : "Demo"}</span>
                </div>
                <dl>
                  <div><dt>{num(calls.length)}</dt><dd>llamadas</dd></div>
                  <div><dt>{num(metrics.citas)}</dt><dd>citas</dd></div>
                  <div><dt>{metrics.kept} %</dt><dd>autónomo</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.centers} id="centros">
          <header><div><h2>Todos los centros</h2><p>Volumen, resultado y coste operativo por sede.</p></div><span>{HOSPITALS.length} activos</span></header>
          <div className={styles.table}>
            <div className={styles.tableHead}><span>Centro</span><span>Origen</span><span>Llamadas</span><span>Citas</span><span>Coste anual</span></div>
            {HOSPITALS.map((hospital) => {
              const org = getOrg(hospital.orgSlug);
              const calls = filterSite(groups.find((group) => group.org.slug === hospital.orgSlug)?.calls ?? [], hospital.siteId);
              const metrics = pitch(calls);
              const cost = lineMinutes(calls) * SALES.agentMinute * SALES.days;
              return (
                <div className={styles.tableRow} key={hospital.id}>
                  <div>
                    <Mark
                      initials={GROUP_MARKS[hospital.orgSlug]?.initials ?? hospital.initials}
                      tint={GROUP_MARKS[hospital.orgSlug]?.tint ?? hospital.tint}
                      size={30}
                    />
                    <span><strong>{hospital.name}</strong><small>{hospital.city} · {hospital.siteId}@{orgDomain(hospital.orgSlug)}</small></span>
                  </div>
                  <span className={org?.source === "llamadas" ? styles.sourceReal : styles.sourceDemo}>{org?.source === "llamadas" ? "Logs" : "Demo"}</span>
                  <b>{num(calls.length)}</b>
                  <b>{num(metrics.citas)}</b>
                  <b>{euro(cost)}</b>
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.agent} id="agente">
          <header>
            <div><h2>Configuración del agente</h2><p>Voz, comportamiento, seguridad y publicación.</p></div>
          </header>
          <div className={styles.configPanel}>
            <AgentControl initialState={agentConfig} />
          </div>
        </section>

        <section className={styles.access} id="accesos">
          <header><div><h2>Accesos por correo</h2><p>El dominio abre el grupo; el buzón determina el rol.</p></div></header>
          <div className={styles.accessGrid}>
            <article>
              <h3>Roles</h3>
              {mailboxExamples().map((row) => (
                <div key={row.local}><code>{row.local}@</code><span>{ROLE_LABEL[row.role]}</span><small>{row.note}</small></div>
              ))}
            </article>
            <article>
              <h3>Dominios autorizados</h3>
              {ORGS.map((org) => (
                <div key={org.slug}><strong>{org.name}</strong><code>{orgDomain(org.slug)}</code></div>
              ))}
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
