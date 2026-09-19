"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logout } from "./Logout";
import { Mark } from "./Mark";
import { ROLE_LABEL, navFor, type DeskRole } from "@/lib/auth";
import styles from "./OrgShell.module.css";

const ORG_MARKS: Record<string, string> = {
  arenal: "A",
  quironsalud: "Q+",
  sanitas: "S",
};

export function OrgShell({
  orgName,
  orgSlug,
  role,
  tint,
  children,
}: {
  orgName: string;
  orgSlug: string;
  role: DeskRole;
  tint: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const base = `/g/${orgSlug}`;
  const initials = ORG_MARKS[orgSlug] ?? orgName.slice(0, 1).toUpperCase();

  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/">
          <span>h</span>
          <strong>hash</strong>
        </Link>
        <div className={styles.org}>
          <Mark initials={initials} tint={tint} />
          <div>
            <p>{orgName}</p>
            <span>{ROLE_LABEL[role]} · Grupo</span>
          </div>
        </div>
        <nav className={styles.nav}>
          {navFor(role).map((item) => {
            const href = `${base}${item.href}`;
            const on = item.href === "" ? path === base : path.startsWith(href);
            return (
              <Link key={item.href} href={href} className={on ? styles.active : ""}>
                <span>{item.href === "" ? "Resumen" : item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className={styles.sidebarFoot}>
          <div className={styles.status}><i /> Línea operativa</div>
          <Logout />
        </div>
      </aside>
      <section className={styles.content}>{children}</section>
    </div>
  );
}
