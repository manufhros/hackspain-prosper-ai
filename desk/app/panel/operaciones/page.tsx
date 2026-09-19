import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canOpen, homeFor } from "@/lib/auth";
import { Operations } from "@/components/operations/Operations";

export const dynamic = "force-dynamic";
export default async function OperationsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/operaciones")) redirect(homeFor(session));
  return <Operations />;
}
