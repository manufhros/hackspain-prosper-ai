import { notFound } from "next/navigation";
import { getOrg } from "@/lib/orgs";
import { filterSite } from "@/lib/metrics";
import { callsForOrg } from "./call-data";

export async function orgCalls(orgSlug: string, sede?: string) {
  const org = getOrg(orgSlug);
  if (!org) notFound();
  return { org, calls: filterSite(await callsForOrg(org), sede) };
}
