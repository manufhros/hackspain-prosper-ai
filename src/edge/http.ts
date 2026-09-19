import html from "./public/index.html" with { type: "text" };
import css from "./public/style.css" with { type: "text" };
import app from "./public/app.js" with { type: "text" };
import audio from "./public/audio.js" with { type: "text" };
import capture from "./public/capture.js" with { type: "text" };
import locale from "./public/locale.js" with { type: "text" };
import type { TraceEvent } from "../voice/agent";

const assets = new Map<string, [string, string]>([
  // Bun's HTML declaration describes its default loader, not the explicit text loader.
  ["/edge/", [html as unknown as string, "text/html"]],
  ["/edge/style.css", [css, "text/css"]],
  ["/edge/app.js", [app, "text/javascript"]],
  ["/edge/audio.js", [audio, "text/javascript"]],
  ["/edge/capture.js", [capture, "text/javascript"]],
  ["/edge/locale.js", [locale, "text/javascript"]],
]);
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The kiosk runs on the edge device itself. Never trust forwarded headers. */
export function edgeAllowed(request: Request, address?: string): boolean {
  const url = new URL(request.url);
  if (!loopback.has(address ?? "") || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  return request.headers.get("origin") === url.origin;
}

export function edgeAsset(request: Request, address?: string): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/edge" && !url.pathname.startsWith("/edge/")) return;
  if (!loopback.has(address ?? "") || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return new Response("Local kiosk only", { status: 403 });
  if (url.pathname === "/" || url.pathname === "/edge") return Response.redirect(`${url.origin}/edge/`, 302);
  const asset = assets.get(url.pathname);
  if (!asset) return;
  return new Response(asset[0], { headers: {
    "content-type": `${asset[1]}; charset=utf-8`, "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "permissions-policy": "microphone=(self), camera=(), geolocation=()",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
}

/** Only public interaction states cross into the kiosk; no tool traces or caller PII. */
export function edgeEvent(event: TraceEvent): Record<string, string> | undefined {
  if (event.stage === "end") return { event: "edge_end", reason: event.detail };
  if (["speech_start", "interruption"].includes(event.stage)) return { event: "edge_state", state: "listening" };
  if (["utterance", "asr_start", "slow_turn"].includes(event.stage)) return { event: "edge_state", state: "thinking" };
  return;
}
