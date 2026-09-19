"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Overview", exact: true },
  { href: "/leaderboard", label: "Ranking" },
  { href: "/run-all", label: "Run All" },
  { href: "/tests", label: "Tests" },
  { href: "/call", label: "Probar" },
  { href: "/problems", label: "Problemas" },
  { href: "/clinic", label: "Clínica" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-10 bg-background">
      {/* Tira de teselas, como el marco de hackspain.app */}
      <div className="flex h-2 border-b-[3px] border-foreground">
        {["bg-hs-orange", "bg-hs-cream", "bg-hs-yellow", "bg-hs-teal", "bg-hs-red", "bg-hs-navy", "bg-hs-cream", "bg-hs-orange"].map((c, i) => (
          <span key={i} className={cn("flex-1 border-r-[3px] border-foreground last:border-r-0", c)} />
        ))}
      </div>
      <div className="flex items-center gap-6 border-b-[3px] border-foreground px-6 py-3">
        <span className="font-heading text-lg uppercase leading-none tracking-wide">
          <span className="text-hs-red">Hack</span>
          <span className="text-hs-orange">Spain</span>
          <span className="ml-2 text-xs text-muted-foreground">· hash</span>
        </span>
        <nav className="flex gap-2">
          {ITEMS.map((i) => {
            const active = i.exact ? path === i.href : path.startsWith(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                className={cn(
                  "border-2 px-3 py-1.5 font-heading text-[11px] uppercase tracking-wide transition-colors",
                  active
                    ? "border-foreground bg-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-foreground hover:text-foreground",
                )}
              >
                {i.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
