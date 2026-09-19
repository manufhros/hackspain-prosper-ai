import { VoiceSimulator } from "@/components/VoiceSimulator";
import { canOpen, homeFor } from "@/lib/auth";
import { listPublicCases } from "@/lib/cases/load";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Pruebas() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/pruebas")) redirect(homeFor(session));

  const cases = listPublicCases();
  const initial = cases[Math.floor(Math.random() * Math.max(cases.length, 1))];
  return <VoiceSimulator scenarios={cases} initialId={initial?.id ?? ""} />;
}
