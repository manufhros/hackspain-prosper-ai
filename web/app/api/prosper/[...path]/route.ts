import { NextRequest, NextResponse } from "next/server";
import { CookieExpiredError, prosperFetch, TEAM_ID } from "@/lib/prosper-server";

export const dynamic = "force-dynamic";

// Solo rutas de lectura conocidas: esto NO es un proxy abierto.
// "team" es un alias de teams/{TEAM_ID}.
const ALLOWED = [
  /^session$/,
  /^board$/,
  /^team$/,
  /^problems$/,
  /^problems\/[\w-]+$/,
  /^problems\/[\w-]+\/submissions$/,
  /^clinic$/,
  /^clinic\/patients$/,
];

// Next 15+: params es una Promise
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const key = (await params).path.join("/");
  if (!ALLOWED.some((re) => re.test(key))) {
    return NextResponse.json({ error: "not_allowed" }, { status: 404 });
  }

  const upstream = key === "team" ? `teams/${TEAM_ID}` : key;

  try {
    const res = await prosperFetch(`/leaderboard/api/${upstream}${req.nextUrl.search}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream", status: res.status }, { status: 502 });
    }

    const data = await res.json();
    // El endpoint del agente lleva un token en la URL: no debe llegar al navegador
    if (key === "team" && data?.integration) delete data.integration.endpoint;

    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof CookieExpiredError) {
      return NextResponse.json({ error: "cookie_expired" }, { status: 401 });
    }
    throw e;
  }
}
