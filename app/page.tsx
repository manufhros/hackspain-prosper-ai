import { DeskView } from "@/components/desk-view";
import { getClinicSource } from "@/lib/clinic/source";

export default async function HomePage() {
  const source = getClinicSource();
  const [health, catalog] = await Promise.all([source.health(), source.clinic()]);
  return <DeskView source={source.info} health={health} catalog={catalog} />;
}
