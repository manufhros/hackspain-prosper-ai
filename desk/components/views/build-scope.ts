import "server-only";

import type { DeskRole } from "@/lib/auth";
import { HOSPITALS } from "@/lib/hospitals";
import { orgScope } from "@/lib/org-scope";
import { hospitalScope } from "@/lib/scope";
import { getSession } from "@/lib/session";
import type { ViewScope } from "./scope";

async function roleFromSession(): Promise<DeskRole> {
  const session = await getSession();
  if (session?.kind === "org" || session?.kind === "site") return session.role;
  return "direccion";
}

/** Builds the shared view scope for a whole group (`/g/[org]`). */
export async function orgViewScope(slug: string): Promise<ViewScope> {
  const [{ org, calls }, role] = await Promise.all([orgScope(slug), roleFromSession()]);
  return {
    kind: "org",
    org,
    sites: HOSPITALS.filter((hospital) => hospital.orgSlug === slug),
    base: `/g/${slug}`,
    role,
    calls,
    live: org.source === "llamadas",
  };
}

/** Builds the shared view scope for a single hospital (`/h/[hid]`). */
export async function hospitalViewScope(hid: string): Promise<ViewScope> {
  const [{ hospital, org, calls }, role] = await Promise.all([hospitalScope(hid), roleFromSession()]);
  return {
    kind: "hospital",
    org,
    hospital,
    sites: [hospital],
    base: `/h/${hid}`,
    role,
    calls,
    live: org.source === "llamadas",
  };
}
