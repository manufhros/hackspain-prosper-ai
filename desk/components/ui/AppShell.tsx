"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import type { NavGroup } from "@/lib/nav";
import { ICONS } from "./icons";
import styles from "./AppShell.module.css";

export type AppShellProps = {
  brandHref: string;
  workspace: { name: string; meta: string; initials: string; tint: string };
  groups: NavGroup[];
  user: { email: string; roleLabel: string };
  children: React.ReactNode;
};

type RuntimeHealth = { ok: boolean; activeCalls: number };

function initialsOf(email: string) {
  const local = email.split("@")[0] ?? "";
  return local.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "H";
}

/** Polls the voice runtime so every screen shows the same live status. */
function useRuntimeHealth(intervalMs = 10_000) {
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/agent-status", { cache: "no-store" });
        const value = (await response.json()) as RuntimeHealth;
        if (active) setHealth({ ok: value.ok === true, activeCalls: value.activeCalls ?? 0 });
      } catch {
        if (active) setHealth({ ok: false, activeCalls: 0 });
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, intervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return health;
}

export function AppShell({ brandHref, workspace, groups, user, children }: AppShellProps) {
  const path = usePathname();
  const router = useRouter();
  const health = useRuntimeHealth();

  function isActive(href: string, exact?: boolean) {
    if (exact) return path === href;
    return path === href || path.startsWith(`${href}/`);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  const statusLabel =
    health == null
      ? "Comprobando agente…"
      : health.ok
        ? health.activeCalls
          ? `Agente activo · ${health.activeCalls} en curso`
          : "Agente activo · sin llamadas"
        : "Agente sin respuesta";

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href={brandHref} aria-label="turno, inicio">
          <span>t</span>
          <strong>turno</strong>
        </Link>

        <div className={styles.workspace}>
          <span className={styles.wsMark} style={{ background: workspace.tint }}>
            {workspace.initials}
          </span>
          <span className={styles.wsText}>
            <strong>{workspace.name}</strong>
            <small>{workspace.meta}</small>
          </span>
        </div>

        <nav className={styles.nav} aria-label="Secciones">
          {groups.map((group) => (
            <div key={group.label} className={styles.group}>
              <p className={styles.groupLabel}>{group.label}</p>
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const on = isActive(item.href, item.exact);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={styles.item}
                    data-active={on}
                    aria-current={on ? "page" : undefined}
                  >
                    {item.emoji ? <span aria-hidden="true">{item.emoji}</span> : <Icon size={18} strokeWidth={1.9} aria-hidden="true" />}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.foot}>
          <p className={styles.status} data-ok={health?.ok ?? "pending"} aria-live="polite">
            <i aria-hidden="true" />
            {statusLabel}
          </p>
          <div className={styles.user}>
            <span className={styles.avatar}>{initialsOf(user.email)}</span>
            <span className={styles.userText}>
              <strong title={user.email}>{user.email}</strong>
              <small>{user.roleLabel}</small>
            </span>
            <button type="button" className={styles.logout} onClick={logout} aria-label="Salir">
              <LogOut size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={`${styles.content} ${path === "/panel/operaciones" ? styles.operationsContent : ""}`}>{children}</div>
      </main>
    </div>
  );
}
