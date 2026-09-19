import { CitasView } from "@/components/views/CitasView";
import { orgViewScope } from "@/components/views/build-scope";

export default async function Citas({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <CitasView scope={await orgViewScope(org)} />;
}
