import { CallMonitor } from "@/components/CallMonitor";
import { readLiveCalls } from "@/lib/live-calls";
import { callsFor, filterSite } from "@/lib/metrics";
import { hospitalScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export default async function MonitorizacionCentro({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const { hospital, org } = await hospitalScope(hid);
  const calls = org.source === "llamadas" ? await readLiveCalls(org.slug) : callsFor(org);
  return (
    <CallMonitor
      calls={filterSite(calls, hospital.siteId)}
      title={`Llamadas · ${hospital.name}`}
      source={org.source}
      crumbs={[
        { label: org.name },
        { label: hospital.name, href: `/h/${hid}` },
        { label: "Monitorización" },
      ]}
    />
  );
}
