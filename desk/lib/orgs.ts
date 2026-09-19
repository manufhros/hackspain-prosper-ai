import type { Org, Person } from "./types";

export const ORGS: Org[] = [
  {
    slug: "arenal",
    name: "Clínica Arenal",
    legal: "Clínica Arenal S.L.",
    kind: "clinica",
    source: "llamadas",
    blurb: "Lo que hay en esta cuenta sale de las llamadas reales de hoy (transcripciones y altas en el registro).",
    hospitals: [
      { id: "centro", name: "Arenal Centro", city: "Madrid" },
      { id: "norte", name: "Arenal Norte", city: "Madrid" },
      { id: "sur", name: "Arenal Sur", city: "Getafe" },
    ],
  },
  {
    slug: "quironsalud",
    name: "Quirónsalud",
    legal: "Grupo hospitalario · demostración",
    kind: "grupo",
    source: "demo",
    blurb: "Cuenta de ejemplo para un grupo. Ningún dato de aquí sale de las llamadas de Arenal.",
    hospitals: [
      { id: "fjd", name: "Fundación Jiménez Díaz", city: "Madrid" },
      { id: "qmad", name: "Quirónsalud Madrid", city: "Pozuelo" },
      { id: "ruber", name: "Ruber Internacional", city: "Madrid" },
      { id: "qbcn", name: "Quirónsalud Barcelona", city: "Barcelona" },
      { id: "tek", name: "Hospital Universitari General de Catalunya", city: "Sant Cugat" },
      { id: "malaga", name: "Quirónsalud Málaga", city: "Málaga" },
    ],
  },
  {
    slug: "sanitas",
    name: "Sanitas",
    legal: "Hospitales propios · demostración",
    kind: "grupo",
    source: "demo",
    blurb: "Cuenta de ejemplo. Cifras inventadas para enseñar el panel de un operador distinto.",
    hospitals: [
      { id: "zarzuela", name: "Hospital Sanitas La Zarzuela", city: "Madrid" },
      { id: "moraleja", name: "Hospital Sanitas La Moraleja", city: "Madrid" },
      { id: "cima", name: "Hospital CIMA", city: "Barcelona" },
      { id: "valencia", name: "Hospital Sanitas Valencia", city: "Valencia" },
    ],
  },
];

export function getOrg(slug: string): Org | undefined {
  return ORGS.find((org) => org.slug === slug);
}

export const PAYROLL: Record<string, Person[]> = {
  arenal: [
    { name: "Pilar Romero", role: "Mostrador · mañanas", site: "Arenal Centro", fte: 1, costYear: 28_400, source: "demo" },
    { name: "Nuria Beltrán", role: "Mostrador · tardes", site: "Arenal Centro", fte: 1, costYear: 27_900, source: "demo" },
    { name: "Javier Coll", role: "Centralita", site: "Arenal Norte", fte: 0.6, costYear: 17_200, source: "demo" },
    { name: "Elena Ruiz", role: "Admisión", site: "Arenal Sur", fte: 1, costYear: 29_100, source: "demo" },
  ],
  quironsalud: [
    { name: "Equipo FJD (12)", role: "Admisión y centralita", site: "Fundación Jiménez Díaz", fte: 12, costYear: 348_000, source: "demo" },
    { name: "Equipo Pozuelo (9)", role: "Admisión", site: "Quirónsalud Madrid", fte: 9, costYear: 261_000, source: "demo" },
    { name: "Equipo Ruber (6)", role: "Centralita", site: "Ruber Internacional", fte: 6, costYear: 174_000, source: "demo" },
    { name: "Equipo BCN (8)", role: "Admisión", site: "Quirónsalud Barcelona", fte: 8, costYear: 232_000, source: "demo" },
  ],
  sanitas: [
    { name: "Equipo Zarzuela (7)", role: "Admisión", site: "Hospital Sanitas La Zarzuela", fte: 7, costYear: 203_000, source: "demo" },
    { name: "Equipo Moraleja (5)", role: "Centralita", site: "Hospital Sanitas La Moraleja", fte: 5, costYear: 145_000, source: "demo" },
    { name: "Equipo CIMA (6)", role: "Admisión", site: "Hospital CIMA", fte: 6, costYear: 174_000, source: "demo" },
  ],
};

/** Hipótesis de coste, no sale de las llamadas. */
export const HUMAN = {
  euroPerHour: 22,
  minutesPerCall: 5,
  label: "22 €/h de mostrador, 5 min por llamada atendida a mano",
};
