import { navFor, type DeskRole } from "./auth";

/** Icon keys resolved on the client by `components/ui/icons.tsx`. */
export type IconName =
  | "dashboard"
  | "calendar"
  | "escalation"
  | "patients"
  | "activity"
  | "business"
  | "plug"
  | "flask"
  | "shield"
  | "radio"
  | "hospital"
  | "settings"
  | "key"
  | "phone";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Match only the exact path (used for the section root). */
  exact?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

const WORKSPACE_META: Record<string, { icon: IconName; group: string }> = {
  "": { icon: "dashboard", group: "Operación" },
  "/citas": { icon: "calendar", group: "Operación" },
  "/escalados": { icon: "escalation", group: "Operación" },
  "/pacientes": { icon: "patients", group: "Operación" },
  "/monitorizacion": { icon: "activity", group: "Operación" },
  "/ahorro": { icon: "business", group: "Negocio" },
  "/integraciones": { icon: "plug", group: "Configuración" },
  "/pruebas": { icon: "flask", group: "Configuración" },
  "/ajustes": { icon: "shield", group: "Configuración" },
};

const GROUP_ORDER = ["Operación", "Negocio", "Configuración"];

/** Role-aware navigation for `/g/[org]` and `/h/[hid]` workspaces. */
export function workspaceNav(role: DeskRole, base: string): NavGroup[] {
  const groups = new Map<string, NavItem[]>();
  for (const item of navFor(role)) {
    const meta = WORKSPACE_META[item.href] ?? { icon: "dashboard" as IconName, group: "Operación" };
    const list = groups.get(meta.group) ?? [];
    list.push({
      href: `${base}${item.href}`,
      label: item.href === "" ? "Resumen" : item.label,
      icon: meta.icon,
      exact: item.href === "",
    });
    groups.set(meta.group, list);
  }
  return GROUP_ORDER.filter((g) => groups.has(g)).map((label) => ({ label, items: groups.get(label)! }));
}

/** Navigation for the hash operator console. */
export function adminNav(): NavGroup[] {
  return [
    {
      label: "Operación",
      items: [
        { href: "/admin", label: "Operación", icon: "dashboard", exact: true },
        { href: "/admin/llamadas", label: "Llamadas", icon: "phone" },
        { href: "/admin/simulador", label: "Simulador", icon: "flask" },
      ],
    },
    {
      label: "Red",
      items: [{ href: "/admin/centros", label: "Hospitales", icon: "hospital" }],
    },
    {
      label: "Agente",
      items: [
        { href: "/admin/agente", label: "Configuración", icon: "settings" },
        { href: "/admin/accesos", label: "Accesos", icon: "key" },
      ],
    },
  ];
}
