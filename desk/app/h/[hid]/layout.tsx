import { AppShell } from "@/components/ui/AppShell";
import { canOpenHospital, ROLE_LABEL } from "@/lib/auth";
import { getHospital, siblings } from "@/lib/hospitals";
import { workspaceNav } from "@/lib/nav";
import { getOrg } from "@/lib/orgs";
import { getSession } from "@/lib/session";
import { notFound, redirect } from "next/navigation";

/** Sections that only exist at group level. */
const GROUP_ONLY = ["/integraciones", "/pruebas"];

export default async function HospitalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ hid: string }>;
}) {
  const { hid } = await params;
  const session = await getSession();
  if (!session) redirect("/");
  if (session.kind === "hash" || !canOpenHospital(session, hid)) redirect("/");
  const hospital = getHospital(hid);
  if (!hospital) notFound();
  const org = getOrg(hospital.orgSlug);

  const base = `/h/${hid}`;
  const role = session.role;
  const live = hospital.source === "llamadas";
  const groups = workspaceNav(role, base)
    .map((group) => ({ ...group, items: group.items.filter((item) => !GROUP_ONLY.some((href) => item.href.endsWith(href))) }))
    .filter((group) => group.items.length);

  const switcher =
    session.kind === "org"
      ? [
          { label: org?.name ?? hospital.group, meta: "Vista de grupo", href: `/g/${hospital.orgSlug}`, active: false },
          ...siblings(hospital).map((item) => ({ label: item.name, meta: item.city, href: `/h/${item.id}`, active: item.id === hid })),
        ]
      : undefined;

  return (
    <AppShell
      brandHref={base}
      workspace={{
        name: hospital.name,
        meta: `${ROLE_LABEL[role]} · ${hospital.city}`,
        initials: hospital.initials,
        tint: hospital.tint,
        switcher,
      }}
      groups={groups}
      user={{ email: session.email, roleLabel: ROLE_LABEL[role] }}
      status={{ ok: live, label: live ? "Línea operativa · datos reales" : "Cuenta de demostración" }}
    >
      {children}
    </AppShell>
  );
}
