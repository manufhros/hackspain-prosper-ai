import { ORGS } from "./orgs";
import type { Source } from "./types";

const TINTS: Record<string, string> = {
  "arenal-centro": "#34523d",
  "arenal-norte": "#4a4038",
  "arenal-sur": "#2b4054",
  "quironsalud-fjd": "#7c2323",
  "quironsalud-qmad": "#1e3d5c",
  "quironsalud-ruber": "#3d3150",
  "quironsalud-qbcn": "#1b4a44",
  "quironsalud-tek": "#4a3d24",
  "quironsalud-malaga": "#5a3324",
  "sanitas-zarzuela": "#0c5b62",
  "sanitas-moraleja": "#1a4b68",
  "sanitas-cima": "#2c4a3c",
  "sanitas-valencia": "#4a2740",
};

export type HospitalAccount = {
  id: string;
  orgSlug: string;
  siteId: string;
  name: string;
  city: string;
  group: string;
  source: Source;
  tint: string;
  initials: string;
};

function initials(name: string): string {
  const parts = name.replace("Hospital ", "").replace("Universitari ", "").split(" ").filter((w) => w.length > 2);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const HOSPITALS: HospitalAccount[] = ORGS.flatMap((org) =>
  org.hospitals.map((h) => {
    const id = `${org.slug}-${h.id}`;
    return {
      id,
      orgSlug: org.slug,
      siteId: h.id,
      name: h.name,
      city: h.city,
      group: org.name,
      source: org.source,
      tint: TINTS[id] ?? "#333",
      initials: initials(h.name),
    };
  }),
);

export function getHospital(id: string): HospitalAccount | undefined {
  return HOSPITALS.find((h) => h.id === id);
}

export function siblings(hospital: HospitalAccount): HospitalAccount[] {
  return HOSPITALS.filter((h) => h.orgSlug === hospital.orgSlug);
}

export function groupedHospitals() {
  const map = new Map<string, HospitalAccount[]>();
  for (const h of HOSPITALS) {
    const list = map.get(h.group) ?? [];
    list.push(h);
    map.set(h.group, list);
  }
  return [...map.entries()];
}
