import { OrgShell } from "@/components/OrgShell";
import { canOpenOrg } from "@/lib/auth";
import { HOSPITALS } from "@/lib/hospitals";
import { getOrg } from "@/lib/orgs";
import { getSession } from "@/lib/session";
import { notFound, redirect } from "next/navigation";

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
  const tint = HOSPITALS.find((h) => h.orgSlug === slug)?.tint ?? "#1c1c1a";
  return (
    <OrgShell orgName={org.name} orgSlug={org.slug} role={session.role} tint={tint}>
      {children}
    </OrgShell>
  );
}
