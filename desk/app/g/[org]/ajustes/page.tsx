import { SettingsForm } from "@/components/SettingsForm";
import { getOrg } from "@/lib/orgs";
import { notFound } from "next/navigation";

export default async function Ajustes({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = getOrg(slug);
  if (!org) notFound();
  return (
    <>
      <h1>Privacidad</h1>
      <p className="lede">{org.name}</p>
      <SettingsForm org={org.slug} />
    </>
  );
}
