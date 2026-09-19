import { EscaladosView } from "@/components/views/EscaladosView";
import { hospitalViewScope } from "@/components/views/build-scope";

export default async function Escalados({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  return <EscaladosView scope={await hospitalViewScope(hid)} />;
}
