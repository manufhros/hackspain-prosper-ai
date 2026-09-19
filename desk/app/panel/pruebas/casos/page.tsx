import { canOpen, homeFor } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function CasosPublicos() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/pruebas")) redirect(homeFor(session));
  redirect("/panel/pruebas");
}
