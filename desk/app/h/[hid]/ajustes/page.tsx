import { SettingsForm } from "@/components/SettingsForm";
import { getHospital } from "@/lib/hospitals";
import { notFound } from "next/navigation";

export default async function Ajustes({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const hospital = getHospital(hid);
  if (!hospital) notFound();
  return (
    <>
      <h1>Privacidad</h1>
      <p className="lede">{hospital.name}</p>
      <SettingsForm org={hospital.id} />
    </>
  );
}
