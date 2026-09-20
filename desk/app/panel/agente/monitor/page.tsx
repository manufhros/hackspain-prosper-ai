import { CallRefresh } from "@/components/CallRefresh";
import { EndpointMonitor } from "@/components/views/EndpointMonitor";
import { canOpen, homeFor } from "@/lib/auth";
import { clinicCalls, orgCalls } from "@/lib/call-data";
import { CLINIC } from "@/lib/clinic";
import { isKnownOrganisation, ORGANISATIONS } from "@/lib/orgs";
import { readOrgAgentConfig } from "@/lib/org-agent-config";
import { lineCalls, peakTimeline, recentRange } from "@/lib/reporting";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgenteMonitor({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/agente")) redirect(homeFor(session));

  const clinicOnly = session.role !== "admin";
  const query = await searchParams;
  const requested = query.org?.trim() ?? "";
  const orgSlug = clinicOnly
    ? CLINIC.slug
    : isKnownOrganisation(requested) ? requested : ORGANISATIONS[0]!.slug;
  const organisation = ORGANISATIONS.find((item) => item.slug === orgSlug)!;
  const range = recentRange(new Date());
  const backHref = clinicOnly ? "/panel/agente" : `/panel/agente?org=${orgSlug}`;

  const [calls, initialConfig] = await Promise.all([
    clinicOnly ? clinicCalls(range) : orgCalls(orgSlug, range),
    readOrgAgentConfig(orgSlug),
  ]);

  return (
    <>
      <CallRefresh />
      <EndpointMonitor
        organisation={organisation.name}
        timeline={peakTimeline(lineCalls(calls), range)}
        backHref={backHref}
        initialConfig={initialConfig}
      />
    </>
  );
}
