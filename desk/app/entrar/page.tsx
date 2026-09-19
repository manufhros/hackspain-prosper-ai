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
        <section className={styles.loginCard}>
          <div className={styles.lock}>Acceso seguro</div>
          <h2>Entrar</h2>
          <p>Escribe tu correo o entra como clínica o como admin.</p>
          <LoginForm failed={query.e === "1"} autofocus />
        </section>
      </main>
    </div>
  );
}
