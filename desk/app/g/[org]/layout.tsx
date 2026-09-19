import { AppShell } from "@/components/ui/AppShell";
import { canOpenOrg, ROLE_LABEL } from "@/lib/auth";
import { HOSPITALS } from "@/lib/hospitals";
import { workspaceNav } from "@/lib/nav";
import { getOrg } from "@/lib/orgs";
import { getSession } from "@/lib/session";
import { notFound, redirect } from "next/navigation";

const ORG_MARKS: Record<string, { initials: string; tint: string }> = {
  arenal: { initials: "A", tint: "#256554" },
  quironsalud: { initials: "Q+", tint: "#0089a6" },
  sanitas: { initials: "S", tint: "#007d8a" },
};

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const session = await getSession();
  if (!session) redirect("/");
  if (session.kind === "hash" || !canOpenOrg(session, slug)) redirect("/");
  const org = getOrg(slug);
  if (!org) notFound();

  const base = `/g/${slug}`;
  const sites = HOSPITALS.filter((hospital) => hospital.orgSlug === slug);
  const mark = ORG_MARKS[slug] ?? { initials: org.name.slice(0, 1).toUpperCase(), tint: "#0b3b49" };
  const live = org.source === "llamadas";

  return (
    <AppShell
      brandHref={base}
      workspace={{
        name: org.name,
        meta: `${ROLE_LABEL[session.role]} · ${org.kind === "grupo" ? "Grupo" : "Clínica"}`,
        initials: mark.initials,
        tint: mark.tint,
        switcher: [
          { label: org.name, meta: `Vista de grupo · ${sites.length} centros`, href: base, active: true },
          ...sites.map((hospital) => ({ label: hospital.name, meta: hospital.city, href: `/h/${hospital.id}`, active: false })),
        ],
      }}
      groups={workspaceNav(session.role, base)}
      user={{ email: session.email, roleLabel: ROLE_LABEL[session.role] }}
      status={{ ok: live, label: live ? "Línea operativa · datos reales" : "Cuenta de demostración" }}
    >
      {children}
    </AppShell>
  );
}
