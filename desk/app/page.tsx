import Link from "next/link";
import { LeadForm } from "@/components/LeadForm";
import styles from "./landing.module.css";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; lead?: string }>;
}) {
  const query = await searchParams;
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link className={styles.logo} href="/" aria-label="turno, inicio"><span>t</span> turno</Link>
        <nav>
          <a href="/entrar">Entrar</a>
          <a className={styles.navCta} href="#demo">Ver una demo</a>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>La recepción que nunca pone en espera</p>
          <h1>No Esperes Tu <span className={styles.heroAccent}>Turno</span></h1>
          <p className={styles.heroLead}>
            turno atiende cada llamada, consulta vuestra agenda y deja la cita cerrada mientras vuestro equipo cuida a
            quien ya está en la clínica.
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href="#demo">Pedir una demo</a>
            <a className={styles.secondary} href="#producto">Ver una llamada</a>
          </div>
        </div>

        <div className={styles.callStage} aria-label="Ejemplo de una llamada gestionada por turno">
          <div className={styles.glow} />
          <div className={styles.callCard}>
            <div className={styles.callTop}>
              <div><span className={styles.liveDot} />Llamada en curso</div>
              <time>01:18</time>
            </div>
            <div className={styles.caller}>
              <span>MS</span>
              <div><strong>María Sánchez</strong><small>Paciente · Sanitas</small></div>
              <div className={styles.wave} aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
            </div>
            <div className={styles.transcript}>
              <p><span>María</span> Necesito traumatología por la tarde, lo antes posible.</p>
              <p><span>turno</span> Tengo el martes a las 16:20 en Arenal Centro. ¿Te viene bien?</p>
            </div>
            <div className={styles.booked}>
              <span>✓</span>
              <div><strong>Cita confirmada</strong><small>Traumatología · Mar 22 · 16:20</small></div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.marquee} aria-label="Capacidades">
        <div><span>Contesta al instante</span><i /><span>Reserva en agenda real</span><i /><span>Escala urgencias</span><i /><span>Habla varios idiomas</span></div>
      </section>

      <section className={styles.story} id="producto">
        <div className={styles.stickyTitle}>
          <h2>Una conversación.<br />Todo resuelto.</h2>
        </div>
        <div className={styles.steps}>
          <article>
            <b>01</b>
            <div className={styles.stepVisual}><span className={styles.ring}>0 s</span></div>
            <h3>Responde antes de que cuelguen</h3>
            <p>Sin menús, música ni “deje su mensaje”. Entiende el motivo desde la primera frase.</p>
          </article>
          <article>
            <b>02</b>
            <div className={styles.stepVisual}><span className={styles.chip}>Paciente encontrado</span><span className={styles.chip}>Póliza verificada</span></div>
            <h3>Trabaja con vuestro sistema</h3>
            <p>Identifica al paciente, respeta sedes y especialistas y consulta disponibilidad real.</p>
          </article>
          <article>
            <b>03</b>
            <div className={styles.stepVisual}><strong className={styles.bigCheck}>✓</strong></div>
            <h3>Termina el trabajo</h3>
            <p>Reserva, cambia o anula. Si hace falta criterio humano, escala con todo el contexto.</p>
          </article>
        </div>
      </section>

      <section className={styles.results}>
        <div>
          <p>Actividad que puedes consultar</p>
          <h2>No promete que devolverá la llamada.<br />La resuelve.</h2>
        </div>
      </section>

      <section className={styles.finalCta} id="demo">
        <div>
          <p>Empezad por una línea. Medidlo todo.</p>
          <h2>Escuchad a turno reservar una cita con vuestra agenda.</h2>
          <p>Os preparamos una demo con un centro, sus horarios y sus reglas. Sin cambiar vuestro teléfono ni vuestro sistema.</p>
        </div>
        <div className={styles.contact}>
          <h3>Pedid una demo</h3>
          <LeadForm state={query.ok === "1" ? "ok" : query.lead === "0" ? "bad" : undefined} />
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerMain}>
          <div className={styles.footerBrand}>
            <Link href="/" aria-label="turno, inicio"><span>t</span> turno</Link>
            <p>La recepción por voz que atiende, agenda y resuelve.</p>
          </div>
          <nav>
            <div>
              <strong>Producto</strong>
              <a href="#producto">Cómo funciona</a>
              <a href="#demo">Pedir una demo</a>
            </div>
            <div>
              <strong>Clientes</strong>
              <a href="/entrar">Entrar al panel</a>
              <span>Soporte en español</span>
            </div>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>© 2026 turno</span>
          <span>Murcia, España</span>
          <span>Datos alojados en la UE</span>
        </div>
      </footer>
    </main>
  );
}
