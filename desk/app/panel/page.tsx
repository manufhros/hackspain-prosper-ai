import { CallRefresh } from "@/components/CallRefresh";
import { clinicDirectory } from "@/lib/clinic-catalog";
import { originFilter, todayRange } from "@/lib/reporting";
import { Overview } from "@/components/views/Overview";
import { canOpen, homeFor } from "@/lib/auth";
import { clinicCalls } from "@/lib/call-data";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PanelHome({ searchParams }: { searchParams: Promise<{ origin?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "")) redirect(homeFor(session));
  const now = new Date();
  const [calls, directory, query] = await Promise.all([clinicCalls(todayRange(now)), clinicDirectory(), searchParams]);
  return <><CallRefresh /><Overview calls={calls} role={session.role} directory={directory}
    origin={originFilter(query.origin)} now={now} /></>;
}
