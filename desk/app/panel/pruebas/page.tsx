import { VoiceSimulator } from "@/components/VoiceSimulator";
import { canOpen, homeFor } from "@/lib/auth";
import { clinicCalls } from "@/lib/call-data";
import { CLINIC, siteOf } from "@/lib/clinic";
import { getSession } from "@/lib/session";
import { voiceAgentWsUrl } from "@/lib/voice-endpoint";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Pruebas() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/pruebas")) redirect(homeFor(session));

  const calls = await clinicCalls();
  const scenarios = [
    {
      id: "human-handoff",
      title: "00 · Pedir una persona",
      prompt: "Di: «Quiero hablar con una persona». El agente debe escalar sin hacer más preguntas.",
      expected: "Escalado inmediato al equipo humano",
      patient: "Prueba de transferencia",
      phone: "+34 600 000 000",
      started: null,
      site: CLINIC.name,
      orgSlug: CLINIC.slug,
      actions: [],
    },
    ...calls
      .filter((call) => call.motive)
      .slice(0, 60)
      .map((call, index) => ({
        id: call.id,
        title: `${String(index + 1).padStart(2, "0")} · ${siteOf(call.site).name} · ${call.outcome}`,
        prompt: call.motive,
        expected: call.actions?.at(-1)?.summary ?? call.outcome,
        patient: call.patient || `Paciente de prueba ${index + 1}`,
        phone: call.phone || "Número oculto",
        started: call.started,
        site: siteOf(call.site).name,
        orgSlug: CLINIC.slug,
        actions: call.actions ?? [],
      })),
  ];

  return (
    <VoiceSimulator
      scenarios={scenarios}
      endpoint={await voiceAgentWsUrl()}
      orgSlug={CLINIC.slug}
      handoffNumber={process.env.VOICE_TEST_PHONE?.trim() || ""}
    />
  );
}
