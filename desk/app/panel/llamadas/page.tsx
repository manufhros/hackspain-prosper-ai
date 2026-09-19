import { CallMonitor } from "@/components/CallMonitor";
import { canOpen, homeFor } from "@/lib/auth";
import { clinicCalls } from "@/lib/call-data";
import { CLINIC } from "@/lib/clinic";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Llamadas() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/llamadas")) redirect(homeFor(session));
  return (
    <CallMonitor
      calls={await clinicCalls()}
      title="Llamadas"
      description={`Cada llamada atendida en ${CLINIC.name}: resultado, motivo y las acciones que ejecutó el agente. Se actualiza solo.`}
      crumbs={[{ label: CLINIC.name, href: homeFor(session) }, { label: "Llamadas" }]}
    />
  );
}
