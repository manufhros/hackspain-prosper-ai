import { cookies } from "next/headers";
import { COOKIE, sessionFromEmail, type Session } from "./auth";

export async function getSession(): Promise<Session | undefined> {
  const email = (await cookies()).get(COOKIE)?.value;
  if (!email) return undefined;
  return sessionFromEmail(email);
}
