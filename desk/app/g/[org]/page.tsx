import { OverviewView } from "@/components/views/OverviewView";
import { orgViewScope } from "@/components/views/build-scope";

export default async function GroupHoy({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <OverviewView scope={await orgViewScope(org)} />;
}
