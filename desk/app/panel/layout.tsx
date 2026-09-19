import { AppShell } from "@/components/ui/AppShell";
import { homeFor, ROLE_LABEL } from "@/lib/auth";
import { CLINIC, SITES } from "@/lib/clinic";
import { panelNav } from "@/lib/nav";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");

  const workspace =
    session.role === "admin"
      ? { name: "Consola turno", meta: `Operación de ${CLINIC.name}`, initials: "t", tint: "#0b3b49" }
      : session.role === "tester"
        ? { name: CLINIC.name, meta: "Entorno de pruebas de voz", initials: CLINIC.initials, tint: CLINIC.tint }
        : { name: CLINIC.name, meta: `Admisión · ${SITES.length} centros`, initials: CLINIC.initials, tint: CLINIC.tint };

  return (
    <AppShell
      brandHref={homeFor(session)}
      workspace={workspace}
      groups={panelNav(session.role)}
      user={{ email: session.email, roleLabel: ROLE_LABEL[session.role] }}
    >
      {children}
    </AppShell>
  );
}
