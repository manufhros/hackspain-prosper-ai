import "server-only";

// .env.local
//   PROSPER_TEAM_ID=baacf3a6-2d56-4c15-8ca4-1b4fd52bb33a
//   PROSPER_COOKIE=prosper_dashboard=<valor completo copiado de DevTools>
//   PROSPER_ORIGIN=https://hackspain.getprosperapp.com   (opcional)

const ORIGIN = process.env.PROSPER_ORIGIN ?? "https://hackspain.getprosperapp.com";
const COOKIE_NAME = "prosper_dashboard";

export const TEAM_ID = process.env.PROSPER_TEAM_ID!;

// La cookie dura 12 h (Max-Age=43200) y cada respuesta reenvía una nueva:
// la guardamos en memoria para que la sesión se renueve sola mientras haya tráfico.
let cookie = process.env.PROSPER_COOKIE!;

export class CookieExpiredError extends Error {
  constructor() {
    super("cookie_expired");
  }
}

export async function prosperFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), cookie },
    cache: "no-store",
  });

  const renewed = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (renewed) cookie = renewed.split(";")[0];

  if (res.status === 401 || res.status === 403) throw new CookieExpiredError();
  return res;
}
