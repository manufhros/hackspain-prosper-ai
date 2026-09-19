import type { Site } from "./clinic";

export type Organisation = {
  slug: string;
  name: string;
  initials: string;
  tint: string;
  sites: Site[];
};

export const ORGANISATIONS: Organisation[] = [
  {
    slug: "arenal",
    name: "Clínica Arenal",
    initials: "A",
    tint: "#256554",
    sites: [
      { id: "centro", name: "Arenal Centro", city: "Madrid", tint: "#34523d", initials: "AC" },
      { id: "norte", name: "Arenal Norte", city: "Madrid", tint: "#4a4038", initials: "AN" },
      { id: "sur", name: "Arenal Sur", city: "Getafe", tint: "#2b4054", initials: "AS" },
    ],
  },
  {
    slug: "quironsalud",
    name: "Clínica Quirón",
    initials: "Q",
    tint: "#31566a",
    sites: [],
  },
  {
    slug: "sanitas",
    name: "Clínica Sanitas",
    initials: "S",
    tint: "#385675",
    sites: [],
  },
];

export function organisationOf(slug: string | null | undefined): Organisation | undefined {
  return ORGANISATIONS.find((item) => item.slug === slug);
}

export function isKnownOrganisation(slug: string): boolean {
  return ORGANISATIONS.some((item) => item.slug === slug);
}
