import { NextRequest, NextResponse } from "next/server";
import { CookieExpiredError, prosperFetch } from "@/lib/prosper-server";

export const dynamic = "force-dynamic";

// Dispara UN Call de un caso público contra un endpoint override, replicando
// el botón "Call" de la UI de Prosper:
//   POST /leaderboard/api/problems/{problem_id}/runs  { case_id, endpoint, headers }
//
// Acotado a propósito: SOLO esta ruta. No puede lanzar Run All (/api/runs) ni
// cambiar el endpoint de Settings (/api/endpoint). El endpoint override es
// OBLIGATORIO, así que nunca marca el endpoint guardado del equipo por error.
const PROBLEM_ID = /^[\w-]+$/;
const CASE_ID = /^[\w-]+$/;

export async function POST(req: NextRequest) {
  let body: { problem_id?: string; case_id?: string; endpoint?: string; headers?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const { problem_id, case_id, endpoint, headers } = body;
  if (!problem_id || !PROBLEM_ID.test(problem_id)) {
    return NextResponse.json({ error: "bad_problem_id" }, { status: 400 });
  }
  if (!case_id || !CASE_ID.test(case_id)) {
    return NextResponse.json({ error: "bad_case_id" }, { status: 400 });
  }
  // Override obligatorio: garantiza que nunca dispara contra Settings/Run All.
  if (!endpoint || !/^wss:\/\//.test(endpoint)) {
    return NextResponse.json({ error: "endpoint_required", detail: "must be a wss:// override" }, { status: 400 });
  }

  try {
    const res = await prosperFetch(`/leaderboard/api/problems/${problem_id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ case_id, endpoint, ...(headers ? { headers } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: "upstream", status: res.status, data }, { status: 502 });
    }
    return NextResponse.json(data); // { run_id }
  } catch (e) {
    if (e instanceof CookieExpiredError) {
      return NextResponse.json({ error: "cookie_expired" }, { status: 401 });
    }
    throw e;
  }
}
