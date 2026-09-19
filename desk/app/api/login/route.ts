import { NextResponse } from "next/server";
import { COOKIE, homeFor, originUrl, sessionFromEmail } from "@/lib/auth";

async function emailFrom(req: Request): Promise<string> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { email?: string } | null;
    return body?.email ?? "";
  }
  const form = await req.formData().catch(() => null);
  return String(form?.get("email") ?? "");
}

export async function POST(req: Request) {
  const session = sessionFromEmail(await emailFrom(req));
  const wantsRedirect = !(req.headers.get("content-type") ?? "").includes("application/json");
  if (!session) {
    if (wantsRedirect) {
      return NextResponse.redirect(originUrl(req, "/?e=1"), 303);
    }
    return NextResponse.json({ error: "Ese correo no está dado de alta." }, { status: 401 });
  }

  const to = homeFor(session);
  const res = wantsRedirect
    ? NextResponse.redirect(originUrl(req, to), 303)
    : NextResponse.json({ ok: true, to });
  res.cookies.set(COOKIE, session.email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
