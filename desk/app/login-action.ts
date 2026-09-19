"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, homeFor, sessionFromEmail } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("account") || formData.get("email") || "");
  const session = sessionFromEmail(email);
  if (!session) {
    redirect("/entrar?e=1");
  }

  const jar = await cookies();
  jar.set(COOKIE, session.email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  redirect(homeFor(session));
}
