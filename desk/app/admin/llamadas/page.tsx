import { CallMonitor } from "@/components/CallMonitor";
import { Logout } from "@/components/Logout";
import { readLiveCalls } from "@/lib/live-calls";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminLlamadas() {
  const session = await getSession();
  if (session?.kind !== "hash") redirect("/");
  const calls = await readLiveCalls();
  return (
    <div className={styles.admin}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/admin"><span>h</span><strong>hash</strong></a>
        <div className={styles.user}><span>LC</span><div><strong>Lucía</strong><small>{session.email}</small></div></div>
        <nav><a href="/admin">Resumen</a><a className={styles.active} href="/admin/llamadas">Llamadas</a><a href="/admin/simulador">Simulador</a></nav>
        <div className={styles.sidebarFoot}><p><i /> Monitor operativo</p><Logout /></div>
      </aside>
      <main className={styles.content}><CallMonitor calls={calls} title="Monitor de llamadas" /></main>
    </div>
  );
}
