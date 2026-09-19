/**
 * Two fixed accounts, no passwords: this is a demo panel behind a cookie.
 * The role decides which sections of /panel are reachable.
 */
export type Role = "admin" | "clinic" | "tester";

export type Session = { email: string; role: Role };

export type Account = { email: string; role: Role; label: string; note: string };

export const ACCOUNTS: Account[] = [
  { email: "admision@clinicaarenal.es", role: "clinic", label: "Clínica Arenal", note: "Resumen y llamadas del centro" },
  { email: "admin@turno.app", role: "admin", label: "Admin", note: "Agente, llamadas y pruebas" },
];

export const COOKIE = "admision";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  clinic: "Admisión",
  tester: "Pruebas de voz",
};

/** Sections under /panel each role may open ("" is the overview). */
const SECTIONS: Record<Role, string[]> = {
  admin: ["", "/llamadas", "/agente", "/pruebas", "/operaciones"],
  clinic: ["", "/llamadas"],
  tester: ["/pruebas", "/llamadas", "/operaciones"],
};

export function originUrl(req: Request, path: string) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const url = new URL(req.url);
  const proto = (req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "") ?? "http").split(",")[0]!.trim();
  if (!host) return new URL(path, url);
  return new URL(path, `${proto}://${host.split(",")[0]!.trim()}`);
}

function normalise(raw: string) {
  return raw.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function sessionFromEmail(raw: string): Session | undefined {
  const email = normalise(raw);
  const account = ACCOUNTS.find((item) => item.email === email);
  return account ? { email: account.email, role: account.role } : undefined;
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
      return parsed.email ? sessionFromEmail(parsed.email) : undefined;
    } catch {
      return undefined;
    }
  }
  return sessionFromEmail(value);
}

export function homeFor(session: Session): string {
  return session.role === "tester" ? "/panel/pruebas" : "/panel";
}

/** `section` is the first segment under /panel, e.g. "" or "/llamadas". */
export function canOpen(role: Role, section: string): boolean {
  return SECTIONS[role].includes(section);
}

export function sectionOf(pathname: string): string | null {
  const match = pathname.match(/^\/panel(?:\/([^/]+))?(?:\/.*)?$/);
  if (!match) return null;
  return match[1] ? `/${match[1]}` : "";
}
