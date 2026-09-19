import { Logout } from "@/components/Logout";
import { VoiceSimulator } from "@/components/VoiceSimulator";
import { readLiveCalls } from "@/lib/live-calls";
import { getSession } from "@/lib/session";
import { HOSPITALS } from "@/lib/hospitals";
import { voiceAgentWsUrl } from "@/lib/voice-endpoint";
import { redirect } from "next/navigation";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export default async function Simulador() {
  const session = await getSession();
  if (session?.kind !== "hash") redirect("/");
  const calls = await readLiveCalls();
  const scenarios = [{
    id: "human-handoff-quiron",
    title: "00 · Quirón · Pedir una persona",
    prompt: "Di: «Quiero hablar con una persona». El agente debe escalar sin hacer más preguntas.",
    expected: "Escalado inmediato al equipo humano",
    patient: "Prueba de transferencia",
    phone: "+34 600 000 000",
    started: null,
    site: "Clínica Quirón",
    orgSlug: "quironsalud",
    actions: [],
  }, ...calls
    .filter((call) => call.motive)
    .map((call, index) => ({
      id: call.id,
      title: `${String(index + 1).padStart(2, "0")} · ${call.siteName} · ${call.outcome}`,
      prompt: call.motive,
      expected: call.actions?.at(-1)?.summary ?? call.outcome,
      patient: call.patient || `Paciente de prueba ${index + 1}`,
      phone: call.phone || "Número oculto",
      started: call.started,
      site: call.siteName,
      orgSlug: HOSPITALS.find((hospital) => hospital.siteId === call.site)?.orgSlug ?? "arenal",
      actions: call.actions ?? [],
    }))];
  const endpoint = await voiceAgentWsUrl();
  return (
    <div className={styles.admin}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/admin"><span>h</span><strong>hash</strong></a>
        <div className={styles.user}><span>LC</span><div><strong>Lucía</strong><small>{session.email}</small></div></div>
        <nav><a href="/admin">Resumen</a><a href="/admin/llamadas">Llamadas</a><a className={styles.active} href="/admin/simulador">Simulador</a></nav>
        <div className={styles.sidebarFoot}><p><i /> Entorno local</p><Logout /></div>
      </aside>
      <main className={styles.content}>
        <VoiceSimulator scenarios={scenarios} endpoint={endpoint} />
      </main>
    </div>
  );
}
