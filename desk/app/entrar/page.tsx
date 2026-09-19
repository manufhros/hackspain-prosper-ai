import { LoginForm } from "@/components/LoginForm";
import styles from "./entrar.module.css";

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const query = await searchParams;
  return (
    <div className={styles.page}>
      <header>
        <a className={styles.logo} href="/" aria-label="Volver a hash">
          <span>h</span> hash
        </a>
        <a className={styles.back} href="/">Volver a la web</a>
      </header>
      <main>
        <section className={styles.intro}>
          <p>Acceso de clientes</p>
          <h1>Vuestro centro,<br />en una pantalla.</h1>
          <p className={styles.lead}>
            Llamadas, citas y escalados de hoy. Cada equipo entra únicamente a los datos de su centro.
          </p>
          <div className={styles.preview} aria-hidden="true">
            <div>
              <div>
                <span>En directo</span>
                <strong>Recepción activa</strong>
              </div>
              <i />
            </div>
            <dl>
              <div><dt>24</dt><dd>llamadas</dd></div>
              <div><dt>16</dt><dd>citas</dd></div>
              <div><dt>1</dt><dd>escalado</dd></div>
            </dl>
          </div>
        </section>
        <section className={styles.loginCard}>
          <div className={styles.lock}>Acceso seguro</div>
          <h2>Entrar</h2>
          <p>Usa el correo que hash ha dado de alta para vuestro centro.</p>
          <LoginForm failed={query.e === "1"} autofocus from="/entrar" />
          <div className={styles.help}>
            ¿Todavía no tenéis acceso? <a href="/#demo">Pedid una demo</a>
          </div>
        </section>
      </main>
    </div>
  );
}
