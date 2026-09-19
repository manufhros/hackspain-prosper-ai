import type { CapturedAction } from "../clinic/tools.ts";

type Accept = { actions: Record<string, unknown>[] };

/** Una acción capturada casa con una esperada si el tipo y todos los campos
 * de la esperada coinciden (los ids se comparan exactos, sin normalizar). */
function actionMatches(got: CapturedAction, exp: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(exp)) {
    if (String(got[k] ?? "") !== String(v ?? "")) return false;
  }
  return true;
}

/** Un set capturado casa con un acceptable si hay biyección campo-a-campo. */
function setMatches(got: CapturedAction[], accept: Accept): boolean {
  if (got.length !== accept.actions.length) return false;
  const used = new Set<number>();
  for (const exp of accept.actions) {
    const i = got.findIndex((g, idx) => !used.has(idx) && actionMatches(g, exp));
    if (i < 0) return false;
    used.add(i);
  }
  return true;
}

export function scoreCase(
  got: CapturedAction[],
  acceptable: Accept[],
): { pass: boolean; expected: string } {
  const pass = acceptable.some((a) => setMatches(got, a));
  const expected = acceptable
    .map((a) => a.actions.map((x) => `${x.action}(${Object.entries(x).filter(([k]) => k !== "action").map(([k, v]) => `${k}=${v}`).join(",")})`).join("+"))
    .join("  |  ");
  return { pass, expected };
}
