import { CallMonitor } from "@/components/CallMonitor";
import { readLiveCalls } from "@/lib/live-calls";
import { orgScope } from "@/lib/org-scope";
import { callsFor } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export default async function Monitorizacion({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org } = await orgScope(slug);
  const calls = org.source === "llamadas" ? await readLiveCalls() : callsFor(org);
  return <CallMonitor calls={calls} title={`Llamadas de ${org.name}`} source={org.source} />;
}
