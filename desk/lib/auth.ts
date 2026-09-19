import { HOSPITALS, getHospital } from "./hospitals";
import { getOrg } from "./orgs";

export type DeskRole = "direccion" | "admision" | "privacidad" | "ti" | "dev";

export type Session =
  | { email: string; kind: "hash" }
  | { email: string; kind: "org"; orgSlug: string; role: DeskRole }
  | { email: string; kind: "site"; orgSlug: string; hospitalId: string; role: DeskRole };

export const COOKIE = "admision";

export function originUrl(req: Request, path: string) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const url = new URL(req.url);
  const proto = (req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "") ?? "http").split(",")[0]!.trim();
  if (!host) return new URL(path, url);
  return new URL(path, `${proto}://${host.split(",")[0]!.trim()}`);
}

export const ROLE_LABEL: Record<DeskRole, string> = {
  direccion: "Dirección",
  admision: "Admisión",
  privacidad: "Privacidad",
  ti: "TI",
  dev: "Desarrollo",
};

/** Local-part → rol. info@ es el buzón público, no gerencia. */
const LOCAL_ROLE: Record<string, DeskRole> = {
  info: "admision",
  admision: "admision",
  citas: "admision",
  recepcion: "admision",
  direccion: "direccion",
  gerencia: "direccion",
  dg: "direccion",
  privacidad: "privacidad",
  dpo: "privacidad",
  rgpd: "privacidad",
  ti: "ti",
  sistemas: "ti",
  it: "ti",
  dev: "dev",
  desarrollo: "dev",
  api: "dev",
};

const DOMAIN_ORG: Record<string, string> = {
  "quiron.com": "quironsalud",
  "quiron.es": "quironsalud",
  "quironsalud.es": "quironsalud",
  "quironsalud.com": "quironsalud",
  "sanitas.es": "sanitas",
  "sanitas.com": "sanitas",
  "clinicaarenal.es": "arenal",
  "arenal.es": "arenal",
};

const HASH_MAIL = new Set([
  "lucia@hash.app",
  "admin@hash.app",
  "hash@hash.app",
  "lucia@prosper.app",
]);

export function orgDomain(orgSlug: string): string {
  if (orgSlug === "arenal") return "clinicaarenal.es";
  if (orgSlug === "sanitas") return "sanitas.es";
  return "quiron.com";
}

function siteByLocal(orgSlug: string, local: string) {
  return HOSPITALS.find((h) => h.orgSlug === orgSlug && h.siteId.replace(/[^a-z]/g, "") === local);
}

export function sessionFromCookie(raw: string): Session | undefined {
  let value = raw.trim();
  if (!value) return undefined;
  try {
    value = decodeURIComponent(value);
  } catch {
    /* already decoded */
  }
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { email?: string };
      if (parsed.email) return sessionFromEmail(parsed.email);
    } catch {
      return undefined;
    }
  }
  return sessionFromEmail(value);
}

export function sessionFromEmail(raw: string): Session | undefined {
  const email = raw.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (!email.includes("@")) return undefined;
  if (HASH_MAIL.has(email)) return { email, kind: "hash" };

  const [local, domain] = email.split("@");
  if (!local || !domain) return undefined;
  const orgSlug = DOMAIN_ORG[domain];
  if (!orgSlug || !getOrg(orgSlug)) return undefined;

  const role = LOCAL_ROLE[local];
  if (role) return { email, kind: "org", orgSlug, role };

  const site = siteByLocal(orgSlug, local);
  if (site) return { email, kind: "site", orgSlug, hospitalId: site.id, role: "admision" };

  return undefined;
}

export function homeFor(session: Session): string {
  if (session.kind === "hash") return "/admin";
  if (session.kind === "site") return `/h/${session.hospitalId}`;
  if (session.role === "dev") return `/g/${session.orgSlug}/integraciones`;
  if (session.role === "privacidad" || session.role === "ti") return `/g/${session.orgSlug}/ajustes`;
  return `/g/${session.orgSlug}`;
}

export function canOpenHospital(session: Session, hospitalId: string): boolean {
  const hospital = getHospital(hospitalId);
  if (!hospital) return false;
  if (session.kind === "hash") return false;
  if (session.kind === "site") return session.hospitalId === hospitalId;
  return session.orgSlug === hospital.orgSlug;
}

export function canOpenOrg(session: Session, orgSlug: string): boolean {
  return session.kind === "org" && session.orgSlug === orgSlug;
}

const DIR = new Set(["", "/ahorro", "/monitorizacion"]);
const ADM = new Set(["", "/citas", "/escalados", "/pacientes", "/monitorizacion"]);
const PRIV = new Set(["/ajustes"]);
const DEV = new Set(["", "/integraciones", "/monitorizacion", "/pruebas"]);

export function canPath(role: DeskRole, href: string): boolean {
  if (role === "direccion") return DIR.has(href);
  if (role === "admision") return ADM.has(href) || href === "";
  if (role === "privacidad" || role === "ti") return PRIV.has(href);
  if (role === "dev") return DEV.has(href);
  return false;
}

export function navFor(role: DeskRole): { href: string; label: string }[] {
  const all = [
    { href: "", label: "Resumen", roles: ["direccion", "admision", "dev"] as DeskRole[] },
    { href: "/ahorro", label: "Negocio", roles: ["direccion"] as DeskRole[] },
    { href: "/citas", label: "Citas", roles: ["admision"] as DeskRole[] },
    { href: "/escalados", label: "Escalados", roles: ["admision"] as DeskRole[] },
    { href: "/pacientes", label: "Pacientes", roles: ["admision"] as DeskRole[] },
    { href: "/ajustes", label: "Privacidad", roles: ["privacidad", "ti"] as DeskRole[] },
    { href: "/integraciones", label: "Integraciones", roles: ["dev"] as DeskRole[] },
    { href: "/monitorizacion", label: "Monitorización", roles: ["dev", "direccion", "admision"] as DeskRole[] },
    { href: "/pruebas", label: "Pruebas", roles: ["dev"] as DeskRole[] },
  ];
  return all.filter((item) => item.roles.includes(role)).map(({ href, label }) => ({ href, label }));
}

export function mailboxExamples() {
  return [
    { local: "info", role: "admision" as DeskRole, note: "Buzón público" },
    { local: "admision", role: "admision" as DeskRole, note: "Mostrador" },
    { local: "direccion", role: "direccion" as DeskRole, note: "Gerencia" },
    { local: "gerencia", role: "direccion" as DeskRole, note: "Gerencia" },
    { local: "privacidad", role: "privacidad" as DeskRole, note: "DPO" },
    { local: "ti", role: "ti" as DeskRole, note: "Sistemas" },
    { local: "dev", role: "dev" as DeskRole, note: "Integraciones del hospital" },
  ];
}
