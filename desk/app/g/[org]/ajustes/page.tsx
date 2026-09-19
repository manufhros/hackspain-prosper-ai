import { PrivacyView } from "@/components/views/PrivacyView";
import { orgViewScope } from "@/components/views/build-scope";

export default async function Ajustes({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <PrivacyView scope={await orgViewScope(org)} />;
}
