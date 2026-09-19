import { Overview } from "@/components/views/Overview";
import { canOpen, homeFor } from "@/lib/auth";
import { clinicCalls } from "@/lib/call-data";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PanelHome() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "")) redirect(homeFor(session));
  return <Overview calls={await clinicCalls()} role={session.role} />;
}
