import { getHospital } from "./hospitals";
import { filterSite } from "./metrics";
import { callsForOrg } from "./call-data";
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
    calls: filterSite(await callsForOrg(org), hospital.siteId),
  };
}
