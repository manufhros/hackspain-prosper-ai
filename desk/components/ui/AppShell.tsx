"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut } from "lucide-react";
import type { NavGroup } from "@/lib/nav";
import { ICONS } from "./icons";
import styles from "./AppShell.module.css";

export type WorkspaceSwitcherItem = { label: string; meta: string; href: string; active: boolean };

export type AppShellProps = {
  brandHref: string;
  workspace: {
    name: string;
    meta: string;
    initials: string;
    tint: string;
    /** Other workspaces the session may open (sibling hospitals, group view). */
    switcher?: WorkspaceSwitcherItem[];
  };
  groups: NavGroup[];
  user: { email: string; roleLabel: string };
  status?: { ok: boolean; label: string };
  children: React.ReactNode;
};

function initialsOf(email: string) {
  const local = email.split("@")[0] ?? "";
  return local.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "H";
}

export function AppShell({ brandHref, workspace, groups, user, status, children }: AppShellProps) {
  const path = usePathname();
  const router = useRouter();

  function isActive(href: string, exact?: boolean) {
    if (exact) return path === href;
    return path === href || path.startsWith(`${href}/`);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href={brandHref} aria-label="hash, inicio">
          <span>h</span>
          <strong>hash</strong>
        </Link>

        <details className={styles.workspace}>
          <summary>
            <span className={styles.wsMark} style={{ background: workspace.tint }}>
              {workspace.initials}
            </span>
            <span className={styles.wsText}>
              <strong>{workspace.name}</strong>
              <small>{workspace.meta}</small>
            </span>
            {workspace.switcher?.length ? <ChevronsUpDown size={14} aria-hidden="true" /> : null}
          </summary>
          {workspace.switcher?.length ? (
            <div className={styles.wsMenu}>
              {workspace.switcher.map((item) => (
                <Link key={item.href} href={item.href} data-active={item.active}>
                  <strong>{item.label}</strong>
                  <small>{item.meta}</small>
                </Link>
              ))}
            </div>
          ) : null}
        </details>

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
                    <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.foot}>
          {status ? (
            <p className={styles.status} data-ok={status.ok}>
              <i aria-hidden="true" />
              {status.label}
            </p>
          ) : null}
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
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
