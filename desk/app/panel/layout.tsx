import { AppShell } from "@/components/ui/AppShell";
import { homeFor, ROLE_LABEL } from "@/lib/auth";
import { panelNav } from "@/lib/nav";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <AppShell
      brandHref={homeFor(session)}
      groups={panelNav(session.role)}
      user={{ email: session.email, roleLabel: ROLE_LABEL[session.role] }}
    >
      {children}
    </AppShell>
  );
}
