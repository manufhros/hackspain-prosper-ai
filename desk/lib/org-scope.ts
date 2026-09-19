import { getOrg } from "./orgs";
import { callsFor } from "./metrics";
import { notFound } from "next/navigation";

export async function orgScope(slug: string) {
  const org = getOrg(slug);
  if (!org) notFound();
  return { org, calls: callsFor(org) };
}
