"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logout } from "./Logout";
import { Mark } from "./Mark";
import { ROLE_LABEL, navFor, type DeskRole } from "@/lib/auth";
import type { HospitalAccount } from "@/lib/hospitals";

export function Shell({
  hospital,
  role,
  children,
}: {
  hospital: HospitalAccount;
  role: DeskRole;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const base = `/h/${hospital.id}`;

  return (
    <div className="frame">
      <aside className="rail">
        <div className="who">
          <Mark initials={hospital.initials} tint={hospital.tint} />
          <div>
            <p className="who-name">{hospital.name}</p>
            <p className="who-meta">{ROLE_LABEL[role]}</p>
          </div>
        </div>
        <nav>
          {navFor(role).map((item) => {
            const href = `${base}${item.href}`;
            const on = item.href === "" ? path === base : path.startsWith(href);
            return (
              <Link key={item.href} href={href} className={on ? "on" : ""}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="rail-foot">
          <Logout />
        </div>
      </aside>
      <div className="main">
        <div className="sheet">{children}</div>
      </div>
    </div>
  );
}
