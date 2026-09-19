import Link from "next/link";
import { LoginForm } from "@/components/LoginForm";
import styles from "./entrar.module.css";

export default async function Entrar({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const query = await searchParams;
  return (
    <div className={styles.page}>
      <header>
        <Link className={styles.logo} href="/" aria-label="Volver a turno">
          <span>t</span> turno
        </Link>
        <Link className={styles.back} href="/">
          Volver a la web
        </Link>
      </header>
      <main>
        <section className={styles.intro}>
          <p>Acceso al panel</p>
          <h1>
            Todo el teléfono,
            <br />
            en una pantalla.
          </h1>
          <p className={styles.lead}>
            Llamadas, citas y escalados de Clínica Arenal en directo. Un panel para el centro, otro para quien opera el agente y un
            entorno para probarlo por voz.
          </p>
          <div className={styles.preview} aria-hidden="true">
            <div>
              <div>
                <span>Datos disponibles al entrar</span>
                <strong>Recepción atendida por turno</strong>
              </div>
              <i />
            </div>
            <dl>
              <div>
                <dt>Llamadas</dt>
                <dd>registro y transcripción</dd>
              </div>
              <div>
                <dt>Citas</dt>
                <dd>acciones registradas</dd>
              </div>
              <div>
                <dt>Escalados</dt>
                <dd>solicitudes de atención</dd>
              </div>
            </dl>
          </div>
        </section>
        <section className={styles.loginCard}>
          <div className={styles.lock}>Acceso seguro</div>
          <h2>Entrar</h2>
          <p>Escribe tu correo o elige una de las tres cuentas de la demo.</p>
          <LoginForm failed={query.e === "1"} autofocus />
        </section>
      </main>
    </div>
  );
}
