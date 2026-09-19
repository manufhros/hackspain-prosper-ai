import { CallRefresh } from "@/components/CallRefresh";
import { clinicDirectory, directoryForOrg } from "@/lib/clinic-catalog";
import { originFilter, todayRange } from "@/lib/reporting";
import { Overview } from "@/components/views/Overview";
import { canOpen, homeFor } from "@/lib/auth";
import { adminOrgSummaries, clinicCalls, orgCalls } from "@/lib/call-data";
import { isKnownOrganisation, ORGANISATIONS } from "@/lib/orgs";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PanelHome({
  searchParams,
}: {
  searchParams: Promise<{ origin?: string; org?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "")) redirect(homeFor(session));

  const now = new Date();
  const range = todayRange(now);
  const query = await searchParams;
  const origin = originFilter(query.origin);
  const requestedOrg = query.org?.trim() ?? "";
  const selectedOrg = session.role === "admin" && isKnownOrganisation(requestedOrg) ? requestedOrg : null;

  if (session.role === "admin" && !selectedOrg) {
    const [summaries, directory] = await Promise.all([adminOrgSummaries(range), clinicDirectory()]);
    return (
      <>
        <CallRefresh />
        <Overview
          calls={[]}
          role={session.role}
          directory={directory}
          origin={origin}
          now={now}
          organisations={summaries}
        />
      </>
    );
  }

  const orgSlug = selectedOrg ?? ORGANISATIONS[0]!.slug;
  const [calls, directory] = await Promise.all([
    session.role === "admin" ? orgCalls(orgSlug, range) : clinicCalls(range),
    session.role === "admin" ? directoryForOrg(orgSlug) : clinicDirectory(),
  ]);

  return (
    <>
      <CallRefresh />
      <Overview
        calls={calls}
        role={session.role}
        directory={directory}
        origin={origin}
        now={now}
        selectedOrg={session.role === "admin" ? orgSlug : null}
      />
    </>
  );
}
