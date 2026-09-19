import { NegocioView } from "@/components/views/NegocioView";
import { hospitalViewScope } from "@/components/views/build-scope";

export default async function Ahorro({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  return <NegocioView scope={await hospitalViewScope(hid)} />;
}
