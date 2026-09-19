import "server-only";
import { cache } from "react";
import { prosper } from "./prosper";
import { CLINIC, SITES, type Site } from "./clinic";
import { organisationOf } from "./orgs";

export type ClinicDirectory = { name: string; sites: Site[]; available: boolean };

export const clinicDirectory = cache(async (): Promise<ClinicDirectory> => {
  try {
    const catalog = await (await prosper()).clinic();
    if (!catalog.clinic_name || !Array.isArray(catalog.locations)) throw new Error("Invalid clinic catalog");
    return { name: catalog.clinic_name, available: true, sites: catalog.locations.map(location => ({
      id: location.id, name: location.name, city: location.address,
      initials: location.name.split(/\s+/).slice(0, 2).map(word => word[0]).join(""),
      tint: SITES.find(site => site.id === location.id)?.tint ?? CLINIC.tint,
    })) };
  } catch {
    // The configured workspace remains usable; no invented directory or address.
    return { name: CLINIC.name, sites: [], available: false };
  }
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
