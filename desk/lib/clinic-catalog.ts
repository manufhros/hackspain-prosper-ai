import "server-only";
import { cache } from "react";
import { CLINIC, SITES, type Site } from "./clinic";
import { organisationOf } from "./orgs";

export type ClinicDirectory = { name: string; sites: Site[]; available: boolean };

/** Sites for the ops views. Prosper is the booking API the voice agent uses, not this board. */
export const clinicDirectory = cache(async (): Promise<ClinicDirectory> => {
  return { name: CLINIC.name, sites: SITES, available: true };
});

export const directoryForOrg = cache(async (orgSlug: string): Promise<ClinicDirectory> => {
  if (orgSlug === CLINIC.slug) return clinicDirectory();
  const organisation = organisationOf(orgSlug);
  if (!organisation) return { name: orgSlug, sites: [], available: false };
  return {
    name: organisation.name,
    sites: organisation.sites,
    available: organisation.sites.length > 0,
  };
});
