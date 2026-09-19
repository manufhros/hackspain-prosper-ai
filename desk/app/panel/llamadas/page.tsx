import { clinicDirectory, directoryForOrg } from "@/lib/clinic-catalog";
import { CallMonitor } from "@/components/CallMonitor";
import { canOpen, homeFor } from "@/lib/auth";
import { adminOrgSummaries, clinicCalls, orgCalls } from "@/lib/call-data";
import { CLINIC } from "@/lib/clinic";
import { isKnownOrganisation } from "@/lib/orgs";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Llamadas({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/llamadas")) redirect(homeFor(session));

  const query = await searchParams;
  const requestedOrg = query.org?.trim() ?? "";
  const selectedOrg = session.role === "admin" && isKnownOrganisation(requestedOrg) ? requestedOrg : null;
  const liveHref = canOpen(session.role, "/pruebas") ? "/panel/pruebas" : undefined;

  if (session.role === "admin" && !selectedOrg) {
    const [summaries, directory] = await Promise.all([adminOrgSummaries(), clinicDirectory()]);
    const calls = summaries.flatMap((item) => item.calls);
    return (
      <CallMonitor
        calls={calls}
        sites={directory.sites}
        title="Llamadas"
        description="Últimas llamadas de toda la red. Entra en un hospital desde Resumen para acotar por clínica."
        crumbs={[{ label: "Resumen", href: "/panel" }, { label: "Llamadas" }]}
        liveHref={liveHref}
      />
    );
  }

  const [calls, directory] = await Promise.all([
    selectedOrg ? orgCalls(selectedOrg) : clinicCalls(),
    selectedOrg ? directoryForOrg(selectedOrg) : clinicDirectory(),
  ]);

  return (
    <CallMonitor
      calls={calls}
      sites={directory.sites}
      title="Llamadas"
      description={`Últimas 500 llamadas registradas en ${directory.name}, incluidas las pruebas. Resultado, motivo y acciones del agente. Se actualiza automáticamente.`}
      crumbs={[
        { label: session.role === "admin" ? "Resumen" : CLINIC.name, href: homeFor(session) },
        ...(selectedOrg ? [{ label: directory.name, href: `/panel?org=${selectedOrg}` }] : []),
        { label: "Llamadas" },
      ]}
      liveHref={liveHref}
    />
  );
}
