import { notFound } from "next/navigation";
import { getOrg } from "@/lib/orgs";
import { callsFor, filterSite } from "@/lib/metrics";

export async function orgCalls(orgSlug: string, sede?: string) {
  const org = getOrg(orgSlug);
  if (!org) notFound();
  return { org, calls: filterSite(callsFor(org), sede) };
}
