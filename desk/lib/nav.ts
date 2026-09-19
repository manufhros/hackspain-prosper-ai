import { canOpen, type Role } from "./auth";

/** Icon keys resolved on the client by `components/ui/icons.tsx`. */
export type IconName = "dashboard" | "phone" | "settings" | "flask";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  emoji?: string;
  /** Match only the exact path (used for the section root). */
  exact?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

type SectionItem = NavItem & { section: string };

const ALL: Array<{ label: string; items: SectionItem[] }> = [
  {
    label: "Operación",
    items: [
      { section: "", href: "/panel", label: "Resumen", icon: "dashboard", exact: true },
      { section: "/llamadas", href: "/panel/llamadas", label: "Llamadas", icon: "phone" },
    ],
  },
  {
    label: "Agente",
    items: [
      { section: "/agente", href: "/panel/agente", label: "Configuración", icon: "settings" },
      { section: "/pruebas", href: "/panel/pruebas", label: "Pruebas de voz · Lucía", icon: "flask", exact: true },
      { section: "/pruebas", href: "/panel/pruebas/casos", label: "Casos públicos · Guille", icon: "flask" },
    ],
  },
  {
    label: "Demo",
    items: [
      { section: "/operaciones", href: "/panel/operaciones", label: "Hackspain", icon: "phone", emoji: "🚀" },
    ],
  },
];

/** Sidebar navigation for the panel, filtered by what the role may open. */
export function panelNav(role: Role): NavGroup[] {
  return ALL.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => canOpen(role, item.section))
      .map((item) => ({ href: item.href, label: item.label, icon: item.icon, emoji: item.emoji, exact: item.exact })),
  })).filter((group) => group.items.length);
}
