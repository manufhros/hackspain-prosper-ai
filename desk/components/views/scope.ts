import type { DeskRole } from "@/lib/auth";
import type { HospitalAccount } from "@/lib/hospitals";
import type { LoggedCall, Org } from "@/lib/types";

/**
 * Everything a workspace view needs to render for either a whole group
 * (`/g/[org]`) or a single hospital (`/h/[hid]`). Pages build this from the
 * data layer and hand it to the shared views so both scopes stay identical.
 */
export type ViewScope = {
  kind: "org" | "hospital";
  org: Org;
  hospital?: HospitalAccount;
  /** Hospitals in scope: every site of the group, or just the one hospital. */
  sites: HospitalAccount[];
  /** URL prefix for links inside the workspace. */
  base: string;
  role: DeskRole;
  calls: LoggedCall[];
  /** True when the calls come from real logs rather than the demo generator. */
  live: boolean;
};

export function scopeName(scope: ViewScope) {
  return scope.hospital?.name ?? scope.org.name;
}

export function scopeCrumbs(scope: ViewScope, page: string) {
  const crumbs = [{ label: scope.org.name, href: scope.kind === "org" ? scope.base : undefined }];
  if (scope.hospital) crumbs.push({ label: scope.hospital.name, href: scope.base });
  crumbs.push({ label: page, href: undefined });
  return crumbs;
}

export const TONE_COLOR: Record<string, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  brand: "var(--brand-2)",
  neutral: "var(--faint)",
};
