import { NegocioView } from "@/components/views/NegocioView";
import { orgViewScope } from "@/components/views/build-scope";

export default async function Ahorro({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <NegocioView scope={await orgViewScope(org)} />;
}
