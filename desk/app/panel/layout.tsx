import { AppShell } from "@/components/ui/AppShell";
import { homeFor, ROLE_LABEL } from "@/lib/auth";
import { clinicDirectory } from "@/lib/clinic-catalog";
import { CLINIC } from "@/lib/clinic";
import { panelNav } from "@/lib/nav";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");

  const directory = await clinicDirectory();
  const workspace =
    session.role === "admin"
      ? { name: "Consola turno", meta: `Operación de ${directory.name}`, initials: "t", tint: "#0b3b49" }
      : session.role === "tester"
        ? { name: directory.name, meta: "Entorno de pruebas de voz", initials: CLINIC.initials, tint: CLINIC.tint }
        : { name: directory.name, meta: directory.available ? `Admisión · ${directory.sites.length} centros` : "Admisión", initials: CLINIC.initials, tint: CLINIC.tint };

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
