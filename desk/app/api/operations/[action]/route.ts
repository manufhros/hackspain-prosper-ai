import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/lib/session";
import { originUrl } from "@/lib/auth";
import { usesCloudflareStorage } from "@/lib/cloudflare-storage";

export const dynamic = "force-dynamic";
async function proxy(request: Request, context: { params: Promise<{ action: string }> }) {
  const session = await getSession();
  if (!session || !["admin", "tester"].includes(session.role)) return Response.json({ error: "No autorizado" }, { status: 403 });
  const { action } = await context.params;
  if (!["state", "start", "stop", "acknowledge"].includes(action)) return new Response(null, { status: 404 });
  if ((action === "state") !== (request.method === "GET")) return new Response(null, { status: 405 });
  if (request.method === "POST" && request.headers.get("origin") !== originUrl(request, "/").origin) return new Response(null, { status: 403 });
  const secret = process.env.OPERATIONS_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "Configura OPERATIONS_SECRET en desk y voice (mínimo 32 caracteres)." }, { status: 503 });
  try {
    const origin = process.env.OPERATIONS_API_URL || "http://127.0.0.1:7860";
    const url = new URL(`/operations/${action}`, origin);
    let body: string | undefined;
    if (request.method === "POST") {
      const raw = await request.text();
      if (raw.length > 1024) return new Response(null, { status: 413 });
      const input = raw ? JSON.parse(raw) : {};
      body = JSON.stringify({ includePhone: input.includePhone !== false });
    }
    const upstream = new Request(url, {
      method: request.method,
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      ...(body ? { body } : {}), signal: AbortSignal.timeout(20000),
    });
    const response = usesCloudflareStorage()
      ? await getCloudflareContext().env.VOICE_AGENT.fetch(upstream)
      : await fetch(upstream);
    return new Response(await response.text(), { status: response.status, headers: {
      "content-type": "application/json", "cache-control": "no-store",
    } });
  } catch {
    return Response.json({ error: "No se pudo consultar el motor de voz. Comprueba el estado antes de volver a iniciar." }, { status: 502 });
  }
}
export const GET = proxy;
export const POST = proxy;
