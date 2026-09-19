import { Shell } from "@/components/Shell";
import { canOpenHospital } from "@/lib/auth";
import { getHospital } from "@/lib/hospitals";
import { getSession } from "@/lib/session";
import { notFound, redirect } from "next/navigation";

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
  const role = session.role;
  return <Shell hospital={hospital} role={role}>{children}</Shell>;
}
