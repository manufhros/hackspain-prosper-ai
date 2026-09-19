import { CallMonitor } from "@/components/CallMonitor";
import { readLiveCalls } from "@/lib/live-calls";
import { hospitalScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export default async function MonitorizacionCentro({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const { hospital } = await hospitalScope(hid);
  const calls = (await readLiveCalls()).filter((call) => call.site === hospital.siteId);
  return <CallMonitor calls={calls} title={`Llamadas · ${hospital.name}`} />;
}
