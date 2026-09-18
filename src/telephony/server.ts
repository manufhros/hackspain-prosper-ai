import { timingSafeEqual } from "node:crypto";
import { type Server, type ServerWebSocket } from "bun";
import { loadConfig, saveLocal } from "../storage";
import { clinicClient } from "../voice/platform";
import { LocalRuntime } from "../voice/runtime";
import { defaultVad, SharedAudio } from "./audio";
import { PlatformCall, type CallOptions } from "./call";
import { LiveTranscript } from "./transcript";

export const serverHelp = `Prosper / Twilio-compatible voice endpoint

bun run serve                     Listen on 127.0.0.1:7860, submit real test resolutions
bun run serve --dry-run           Same audio protocol; never submit results
bun run serve --port 7861         Override VOICE_PORT
bun run serve --help              Show this help without starting services

Requires PLATFORM_API_KEY (.env or the TUI's Keychain entry).
VOICE_HOST=127.0.0.1  VOICE_PORT=7860  VOICE_LANGUAGE=es  VOICE_MAX_CALLS=20
LLM_PROVIDER=local (default) or openrouter; set OPENROUTER_MODEL and its Setup Keychain key.
Optional VOICE_SERVER_TOKEN requires Authorization: Bearer <token> on /ws.
VOICE_VAD_THRESHOLD=0.015  VOICE_SILENCE_MS=800 tune input turn detection.

Starting serve warms the same local voice stack as bun start. Wait for Ready.
Then start your tunnel yourself: ngrok http 7860
Set Prosper Settings > Integration > Endpoint to wss://<tunnel-host>/ws.
Set its Authorization header too if VOICE_SERVER_TOKEN is configured.
GET /healthz reports readiness. Per-call reports: .workbench/platform-*.json.
Live transcripts print with numbered conversation labels and start/end separators.
No Twilio account, phone number, TwiML endpoint or signature is required by this track.
`;
export function serverConfig(env: Record<string, string | undefined>, args: string[]) {
  let port = env.VOICE_PORT || "7860", live = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") live = false;
    else if (args[i] === "--port" && args[i + 1]) port = args[++i]!;
    else throw new Error(`Unknown or incomplete serve option: ${args[i]}`);
  }
  const integer = (value: string, min: number, max: number, name: string) => {
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be ${min}–${max}`);
    return Number(value);
  };
  const language = env.VOICE_LANGUAGE || "es";
  if (!["en", "es", "ca"].includes(language)) throw new Error("VOICE_LANGUAGE must be en, es or ca");
  const threshold = Number(env.VOICE_VAD_THRESHOLD ?? defaultVad.threshold);
  if (!Number.isFinite(threshold) || threshold < 0.001 || threshold > 0.5) throw new Error("VOICE_VAD_THRESHOLD must be 0.001–0.5");
  const token = env.VOICE_SERVER_TOKEN?.trim() || undefined;
  if (token && (token.length < 16 || token.length > 256 || /\s/.test(token))) throw new Error("VOICE_SERVER_TOKEN must be 16–256 characters without whitespace");
  return { hostname: env.VOICE_HOST || "127.0.0.1", port: integer(port, 1, 65535, "Port"), live, language, token,
    maxCalls: integer(env.VOICE_MAX_CALLS || "20", 1, 20, "VOICE_MAX_CALLS"),
    vad: { ...defaultVad, threshold, silenceMs: integer(env.VOICE_SILENCE_MS || "800", 200, 3000, "VOICE_SILENCE_MS") } };
}
export function authorized(request: Request, token?: string): boolean {
  if (!token) return true;
  const actual = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export interface SocketData { call?: PlatformCall }
type UpgradeServer = Pick<Server<SocketData>, "upgrade">;

/** Export handlers for finite transport tests; constructing them opens no port. */
export function serverHandlers(config: ReturnType<typeof serverConfig>, dependencies: Omit<CallOptions, "socket" | "claim" | "live" | "language" | "vad">,
  ready: () => boolean) {
  const calls = new Set<PlatformCall>(), seen = new Map<string, number>();
  let reserved = 0;
  const claim = (callId: string) => {
    const now = Date.now();
    for (const [id, at] of seen) if (at < now - 600_000) seen.delete(id);
    if (seen.has(callId) || seen.size >= 5000) return false;
    seen.set(callId, now); return true;
  };
  return {
    calls,
    fetch(request: Request, server: UpgradeServer): Response | undefined {
      const url = new URL(request.url);
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (url.pathname === "/healthz") return Response.json({ ready: ready(), active_calls: calls.size, mode: config.live ? "platform" : "dry_run" }, { status: ready() ? 200 : 503 });
      if (url.pathname !== "/ws" || url.search) return new Response("Not found", { status: 404 });
      if (!authorized(request, config.token)) return new Response("Unauthorized", { status: 401 });
      if (!ready()) return new Response("Voice runtime not ready", { status: 503 });
      if (reserved >= config.maxCalls) return new Response("Call capacity reached", { status: 503 });
      reserved++;
      try { if (server.upgrade(request, { data: {} })) return; }
      catch (error) { reserved--; throw error; }
      reserved--;
      return new Response("WebSocket upgrade required", { status: 426 });
    },
    websocket: {
      data: {} as SocketData,
      maxPayloadLength: 8192,
      backpressureLimit: 64 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 60,
      open(socket: ServerWebSocket<SocketData>) {
        const call = new PlatformCall({ ...dependencies, live: config.live, language: config.language, vad: config.vad, claim,
          socket: { send: message => {
            if (socket.getBufferedAmount() > 32 * 1024) throw new Error("Socket output is too far behind real time");
            return socket.send(message);
          }, close: (code, reason) => socket.close(code, reason) } });
        socket.data.call = call; calls.add(call);
        void call.done.finally(() => { calls.delete(call); reserved--; });
      },
      message(socket: ServerWebSocket<SocketData>, message: string | Buffer) { socket.data.call?.receive(message); },
      close(socket: ServerWebSocket<SocketData>) { if (socket.data.call) socket.data.call.end(); else reserved--; },
    },
  };
}

export async function runServer(args: string[]) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) { console.log(serverHelp); return; }
  const config = serverConfig(process.env, args);
  const clinic = await clinicClient(await loadConfig());
  const lifetime = new AbortController();
  const voice = new LocalRuntime(message => console.log(message));
  const transcript = new LiveTranscript();
  const handlers = serverHandlers(config, { inference: voice, audio: new SharedAudio(voice, lifetime.signal), clinic, lifetime: lifetime.signal,
    onEvent: transcript.event,
    async report(report) {
      let saved: string | undefined;
      try { saved = await saveLocal(`platform-${report.session_id}.json`, report); }
      finally { transcript.finish(report, saved); }
    } }, () => voice.state === "ready" && !lifetime.signal.aborted);
  let server: Server<SocketData> | undefined;
  const shutdown = () => { lifetime.abort(new Error("Server shutting down")); voice.stop(); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown); process.once("SIGHUP", shutdown);
  try {
    await voice.start(); lifetime.signal.throwIfAborted();
    server = Bun.serve({ hostname: config.hostname, port: config.port, fetch: handlers.fetch, websocket: handlers.websocket });
    console.log(`Ready: ws://${config.hostname}:${server.port}/ws · ${config.live ? "REAL test submissions" : "dry run, no submissions"} · ${config.token ? "Bearer authentication required" : "no endpoint authentication"}`);
    console.log("Start your tunnel separately and set the public wss://<host>/ws URL in Prosper Settings → Integration.");
    await new Promise<void>(resolve => { if (lifetime.signal.aborted) resolve(); else lifetime.signal.addEventListener("abort", () => resolve(), { once: true }); });
  } finally {
    shutdown();
    await server?.stop(true);
    await Promise.allSettled([...handlers.calls].map(call => call.done));
    process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); process.off("SIGHUP", shutdown);
  }
}
