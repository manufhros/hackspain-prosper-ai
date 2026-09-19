import { getOrg } from "./orgs";
import { callsForOrg } from "./call-data";
import { notFound } from "next/navigation";

export async function orgScope(slug: string) {
  const org = getOrg(slug);
  if (!org) notFound();
  return { org, calls: await callsForOrg(org) };
}
