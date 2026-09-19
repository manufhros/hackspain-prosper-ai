import { VoiceSimulator } from "@/components/VoiceSimulator";
import { callsFor } from "@/lib/metrics";
import { getOrg } from "@/lib/orgs";
import { voiceAgentWsUrl } from "@/lib/voice-endpoint";
import { getSession } from "@/lib/session";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Pruebas({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const session = await getSession();
  if (session?.kind !== "org" || session.orgSlug !== slug || session.role !== "dev") redirect("/");
  const org = getOrg(slug);
  if (!org) notFound();
  const calls = callsFor(org);
  const scenarios = [{
    id: `human-handoff-${slug}`,
    title: "00 · Pedir una persona",
    prompt: "Di: «Quiero hablar con una persona». El agente debe escalar sin hacer más preguntas.",
    expected: "Escalado inmediato al equipo humano",
    patient: "Prueba de transferencia",
    phone: "+34 600 000 000",
    started: null,
    site: org.name,
    orgSlug: slug,
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
      orgSlug: slug,
      actions: call.actions ?? [],
    }))];
  const endpoint = voiceAgentWsUrl();
  return <VoiceSimulator scenarios={scenarios} endpoint={endpoint} orgSlug={slug} />;
}
