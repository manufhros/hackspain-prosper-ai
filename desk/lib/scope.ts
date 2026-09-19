import { getHospital } from "./hospitals";
import { callsFor, filterSite } from "./metrics";
import { getOrg } from "./orgs";
import { notFound } from "next/navigation";

export async function hospitalScope(hid: string) {
  const hospital = getHospital(hid);
  if (!hospital) notFound();
  const org = getOrg(hospital.orgSlug);
  if (!org) notFound();
  return {
    hospital,
    org,
    calls: filterSite(callsFor(org), hospital.siteId),
  };
}
