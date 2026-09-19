import { PacientesView } from "@/components/views/PacientesView";
import { hospitalViewScope } from "@/components/views/build-scope";

export default async function Pacientes({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  return <PacientesView scope={await hospitalViewScope(hid)} />;
}
