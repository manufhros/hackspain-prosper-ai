import { OverviewView } from "@/components/views/OverviewView";
import { hospitalViewScope } from "@/components/views/build-scope";

export default async function Hoy({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  return <OverviewView scope={await hospitalViewScope(hid)} />;
}
