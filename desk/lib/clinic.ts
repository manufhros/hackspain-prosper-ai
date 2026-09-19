/** The single clinic this panel serves. Calls come from its real logs / D1. */
export const CLINIC = {
  slug: "arenal",
  name: "Clínica Arenal",
  legal: "Clínica Arenal S.L.",
  domain: "clinicaarenal.es",
  initials: "A",
  tint: "#256554",
} as const;

export type Site = {
  id: string;
  name: string;
  city: string;
  tint: string;
  initials: string;
};

export const SITES: Site[] = [
  { id: "centro", name: "Arenal Centro", city: "Madrid", tint: "#34523d", initials: "AC" },
  { id: "norte", name: "Arenal Norte", city: "Madrid", tint: "#4a4038", initials: "AN" },
  { id: "sur", name: "Arenal Sur", city: "Getafe", tint: "#2b4054", initials: "AS" },
];

/** Bucket for calls that never got tied to a centre (FAQ, hang-ups, registrations). */
export const UNASSIGNED_SITE: Site = {
  id: "none",
  name: "Sin sede asignada",
  city: "Sede no registrada",
  tint: "#93a6ac",
  initials: "—",
};

export function siteOf(id: string | null | undefined, sites: Site[] = SITES): Site {
  if (!id) return UNASSIGNED_SITE;
  return sites.find((site) => site.id === id) ?? { id, name: id, city: "Nombre del centro no disponible", initials: "—", tint: UNASSIGNED_SITE.tint };
}
