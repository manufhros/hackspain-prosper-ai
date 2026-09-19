import { clinicDirectory } from "@/lib/clinic-catalog";
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
  const [calls, directory] = await Promise.all([clinicCalls(), clinicDirectory()]);
  return (
    <CallMonitor
      calls={calls}
      sites={directory.sites}
      title="Llamadas"
      description={`Últimas 500 llamadas registradas en ${directory.name}, incluidas las pruebas. Resultado, motivo y acciones del agente. Se actualiza automáticamente.`}
      crumbs={[{ label: CLINIC.name, href: homeFor(session) }, { label: "Llamadas" }]}
    />
  );
}
