import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE, canOpen, homeFor, originUrl, sectionOf, sessionFromCookie } from "@/lib/auth";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = sessionFromCookie(req.cookies.get(COOKIE)?.value ?? "");

  const open =
    pathname === "/" ||
    pathname.startsWith("/entrar") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/lead") ||
    // Provider webhooks authenticate with their signature, not a browser cookie.
    pathname === "/api/integrations/elevenlabs/post-call";
  if (open) {
    if (session && (pathname === "/" || pathname.startsWith("/entrar"))) {
      return NextResponse.redirect(originUrl(req, homeFor(session)));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/logout")) return NextResponse.next();

  if (!session) return NextResponse.redirect(originUrl(req, "/"));

  if (pathname === "/api/agent-trace") {
    if (session.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/agent-status")) return NextResponse.next();

  const section = sectionOf(pathname);
  if (section !== null) {
    if (!canOpen(session.role, section)) return NextResponse.redirect(originUrl(req, homeFor(session)));
    return NextResponse.next();
  }

  return NextResponse.redirect(originUrl(req, homeFor(session)));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
