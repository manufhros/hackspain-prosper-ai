import { EscaladosView } from "@/components/views/EscaladosView";
import { orgViewScope } from "@/components/views/build-scope";

export default async function Escalados({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <EscaladosView scope={await orgViewScope(org)} />;
}
