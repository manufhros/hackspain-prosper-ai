import { Suspense } from "react";
import { clinicDirectory, directoryForOrg } from "@/lib/clinic-catalog";
import { CallMonitor } from "@/components/CallMonitor";
import { CallHospitals } from "@/components/views/CallHospitals";
import { canOpen, homeFor } from "@/lib/auth";
import { adminOrgSummaries, clinicCalls, orgCalls } from "@/lib/call-data";
import { CLINIC } from "@/lib/clinic";
import { isKnownOrganisation, ORGANISATIONS } from "@/lib/orgs";
import { lineCalls, recentRange } from "@/lib/reporting";
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
  const range = recentRange();

  if (session.role === "admin" && !selectedOrg) {
    const summaries = await adminOrgSummaries(range);
    return <CallHospitals summaries={summaries} range={range} liveHref={liveHref} />;
  }

  const [raw, directory] = await Promise.all([
    selectedOrg ? orgCalls(selectedOrg, range) : clinicCalls(range),
    selectedOrg ? directoryForOrg(selectedOrg) : clinicDirectory(),
  ]);
  const calls = lineCalls(raw);

  return (
    <Suspense fallback={null}>
    <CallMonitor
      calls={calls}
      sites={directory.sites}
      title={selectedOrg ? directory.name : "Llamadas"}
      description={selectedOrg
        ? `Llamadas de ${directory.name} en estos ${range.days} días. Sin ensayos del simulador.`
        : `Las mismas ${calls.length} de estos ${range.days} días que el Resumen. Sin ensayos del simulador.`}
      crumbs={[
        { label: session.role === "admin" ? "Resumen" : CLINIC.name, href: homeFor(session) },
        ...(selectedOrg ? [{ label: "Llamadas", href: "/panel/llamadas" }, { label: directory.name }] : [{ label: "Llamadas" }]),
      ]}
      liveHref={liveHref}
      hospitals={selectedOrg ? ORGANISATIONS.map((item) => ({ slug: item.slug, name: item.name })) : undefined}
      selectedHospital={selectedOrg}
    />
    </Suspense>
  );
}
