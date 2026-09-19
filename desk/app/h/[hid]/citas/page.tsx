import { CitasView } from "@/components/views/CitasView";
import { hospitalViewScope } from "@/components/views/build-scope";

export default async function Citas({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  return <CitasView scope={await hospitalViewScope(hid)} />;
}
