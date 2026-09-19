import { PacientesView } from "@/components/views/PacientesView";
import { orgViewScope } from "@/components/views/build-scope";

export default async function Pacientes({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <PacientesView scope={await orgViewScope(org)} />;
}
