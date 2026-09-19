import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE, canOpenHospital, canOpenOrg, canPath, homeFor, originUrl, sessionFromCookie } from "@/lib/auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = sessionFromCookie(req.cookies.get(COOKIE)?.value ?? "");

  const open =
    pathname === "/" ||
    pathname.startsWith("/entrar") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/lead");
  if (open) {
    if (session && (pathname === "/" || pathname.startsWith("/entrar"))) {
      return NextResponse.redirect(originUrl(req, homeFor(session)));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/logout")) return NextResponse.next();
  // Provider webhooks authenticate with their signature, not a browser cookie.
  if (pathname === "/api/integrations/elevenlabs/post-call") return NextResponse.next();

  if (!session) return NextResponse.redirect(originUrl(req, "/"));

  if (pathname.startsWith("/api/agent-status") || pathname === "/api/agent-trace") {
    if (session.kind !== "hash") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (session.kind !== "hash") return NextResponse.redirect(originUrl(req, homeFor(session)));
    return NextResponse.next();
  }

  const group = pathname.match(/^\/g\/([^/]+)(\/.*)?$/);
  if (group) {
    const org = group[1];
    const href = group[2] ?? "";
    if (!canOpenOrg(session, org)) return NextResponse.redirect(originUrl(req, homeFor(session)));
    const role = session.kind === "hash" ? "direccion" : session.role;
    if (!canPath(role, href || "")) return NextResponse.redirect(originUrl(req, homeFor(session)));
    return NextResponse.next();
  }

  const site = pathname.match(/^\/h\/([^/]+)(\/.*)?$/);
  if (site) {
    const hid = site[1];
    const href = site[2] ?? "";
    if (!canOpenHospital(session, hid)) return NextResponse.redirect(originUrl(req, homeFor(session)));
    const role = session.kind === "site" || session.kind === "org" ? session.role : "direccion";
    if (!canPath(role, href || "")) return NextResponse.redirect(originUrl(req, homeFor(session)));
    return NextResponse.next();
  }

  return NextResponse.redirect(originUrl(req, homeFor(session)));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
