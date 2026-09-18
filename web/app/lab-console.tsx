"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Phone, PhoneOff, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Status = "idle" | "listening" | "thinking" | "speaking";

type Line = { id: string; role: "user" | "assistant"; text: string };
type ToolHit = {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  ms?: number;
};

type TraceEvent = {
  t: string;
  source: "in" | "out" | "sys";
  type: string;
  stage?: string;
  message?: string;
  ms?: number;
  data?: unknown;
};

type CallTrace = {
  id: string;
  kind: "web" | "twilio";
  startedAt: string;
  endedAt?: string;
  lastError?: string;
  eventCount?: number;
  events: TraceEvent[];
};

type ServerEvent =
  | { type: "ready"; callId: string }
  | { type: "status"; status: Status }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "tool"; tool: { name: string; input: unknown; output: unknown; ms?: number } }
  | { type: "debug"; event: { t: string; stage: string; message: string; data?: unknown; ms?: number } }
  | { type: "audio"; mime: string; data: string }
  | { type: "speak-text"; text: string }
  | { type: "error"; message: string };

const WS_URL = process.env.NEXT_PUBLIC_AGENT_WS ?? "ws://localhost:7860/web";
const JOSEFA =
  "Hi, I am Josefa Domínguez Navarro, DNI 48064716Y, I need the soonest GP appointment.";

const FILTERS = ["todos", "error", "state", "llm", "tool", "stt", "vad", "client", "ws"] as const;
type Filter = (typeof FILTERS)[number];

function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function statusLabel(status: Status, live: boolean): string {
  if (!live) return "Colgado";
  if (status === "listening") return "Te escucha";
  if (status === "thinking") return "Consulta la clínica";
  if (status === "speaking") return "Habla";
  return "En línea";
}

function isRateLimit(text: string | undefined): boolean {
  if (!text) return false;
  return /rate.?limit|429|Free tier|cuota/i.test(text);
}

function eventBucket(event: TraceEvent): Filter | "otros" {
  const key = `${event.stage ?? ""} ${event.type} ${event.message ?? ""}`.toLowerCase();
  if (event.type === "error" || event.stage === "error" || isRateLimit(event.message)) return "error";
  if (event.stage === "state") return "state";
  if (key.includes("tool")) return "tool";
  if (key.includes("llm") || key.includes("generate")) return "llm";
  if (key.includes("stt") || key.includes("whisper")) return "stt";
  if (key.includes("vad")) return "vad";
  if (event.source === "in" || event.stage === "client") return "client";
  if (event.stage === "ws" || event.type === "open" || event.type === "close") return "ws";
  return "otros";
}

function stageClass(event: TraceEvent): string {
  const bucket = eventBucket(event);
  if (bucket === "error") return "text-red-400";
  if (bucket === "state") return "text-cyan-300";
  if (bucket === "tool") return "text-sky-300";
  if (bucket === "llm") return "text-violet-300";
  if (bucket === "stt") return "text-amber-200";
  if (bucket === "vad") return "text-emerald-300";
  if (bucket === "client") return "text-orange-200";
  return "text-zinc-400";
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 23);
  return d.toISOString().slice(11, 23);
}

export function LabConsole() {
  return <LabWorkbench />;
}

function LabWorkbench() {
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [tools, setTools] = useState<ToolHit[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [health, setHealth] = useState<{
    ok: boolean;
    detail: string;
    gateway?: boolean;
    clinic?: boolean;
  }>({ ok: false, detail: "Comprobando agente…" });
  const [calls, setCalls] = useState<CallTrace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [openEvent, setOpenEvent] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const statusRef = useRef<Status>("idle");
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const debugEndRef = useRef<HTMLDivElement | null>(null);

  const refreshDebug = useCallback(async () => {
    try {
      const res = await fetch("/agent/debug", { cache: "no-store" });
      if (!res.ok) throw new Error(`debug ${res.status}`);
      const body = (await res.json()) as { calls?: CallTrace[] };
      const next = body.calls ?? [];
      setCalls(next);
      setSelectedId((current) => {
        if (current && next.some((call) => call.id === current)) return current;
        return next[0]?.id ?? null;
      });
    } catch {
      /* health panel already covers agent down */
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/agent/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { gateway?: boolean; clinic?: boolean; status?: string };
      setHealth({
        ok: true,
        detail: "Agente en :7860",
        gateway: body.gateway,
        clinic: body.clinic,
      });
    } catch (err) {
      setHealth({
        ok: false,
        detail: `Agente caído: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshHealth();
      void refreshDebug();
    }, 0);
    const timer = setInterval(() => {
      void refreshHealth();
      void refreshDebug();
    }, 1500);
    return () => {
      clearTimeout(initialRefresh);
      clearInterval(timer);
    };
  }, [refreshDebug, refreshHealth]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const selected = useMemo(
    () => calls.find((call) => call.id === selectedId) ?? calls[0] ?? null,
    [calls, selectedId],
  );

  const visibleEvents = useMemo(() => {
    const events = selected?.events ?? [];
    if (filter === "todos") return events;
    return events.filter((event) => eventBucket(event) === filter);
  }, [filter, selected]);
  const latestState = useMemo(
    () => [...(selected?.events ?? [])].reverse().find((event) => event.stage === "state")?.data,
    [selected],
  );

  useEffect(() => {
    debugEndRef.current?.scrollIntoView({ block: "end" });
  }, [visibleEvents.length, selectedId]);

  const hangUp = useCallback((fromSocket = false) => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current?.stop();
    sourceRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    mediaRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    if (!fromSocket && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "hangup" }));
      ws.close();
    }
    setLive(false);
    setStatus("idle");
    statusRef.current = "idle";
    void refreshDebug();
  }, [refreshDebug]);

  const notifyPlaybackEnd = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "playback-end" }));
    }
    statusRef.current = "idle";
    setStatus("idle");
  }, []);

  const speakLocal = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        notifyPlaybackEnd();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[áéíóúñ¿¡]/i.test(text) ? "es-ES" : "en-US";
      utterance.rate = 1;
      statusRef.current = "speaking";
      setStatus("speaking");
      utterance.onend = () => notifyPlaybackEnd();
      utterance.onerror = () => notifyPlaybackEnd();
      window.speechSynthesis.speak(utterance);
    },
    [notifyPlaybackEnd],
  );

  const playWav = useCallback(
    async (b64: string) => {
      window.speechSynthesis.cancel();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = ctxRef.current;
      if (ctx) {
        try {
          await ctx.resume();
          const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
          sourceRef.current?.stop();
          const source = ctx.createBufferSource();
          sourceRef.current = source;
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.onended = () => {
            sourceRef.current = null;
            notifyPlaybackEnd();
          };
          source.start();
          return;
        } catch (err) {
          console.warn("decodeAudioData failed, using <audio>", err);
        }
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const audio = audioRef.current;
      if (!audio) {
        notifyPlaybackEnd();
        return;
      }
      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        notifyPlaybackEnd();
      };
      await audio.play().catch((err) => {
        setError(`El navegador bloqueó el audio: ${String(err)}`);
        notifyPlaybackEnd();
      });
    },
    [notifyPlaybackEnd],
  );

  const connect = useCallback(async () => {
    setError(null);
    setLines([]);
    setTools([]);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      setLive(true);
      ws.send(JSON.stringify({ type: "hello" }));
      void refreshDebug();
    };
    ws.onclose = () => hangUp(true);
    ws.onerror = () =>
      setError("WebSocket rechazado. El agente no está en ws://localhost:7860/web");
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerEvent;
      if (msg.type === "ready") {
        setSelectedId(msg.callId);
      }
      if (msg.type === "status") {
        statusRef.current = msg.status;
        setStatus(msg.status);
      }
      if (msg.type === "transcript") {
        setLines((prev) => [...prev, { id: crypto.randomUUID(), role: msg.role, text: msg.text }]);
      }
      if (msg.type === "tool") {
        setTools((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: msg.tool.name,
            input: msg.tool.input,
            output: msg.tool.output,
            ms: msg.tool.ms,
          },
        ]);
      }
      if (msg.type === "speak-text") speakLocal(msg.text);
      if (msg.type === "audio") void playWav(msg.data);
      if (msg.type === "error") setError(msg.message);
    };

    try {
      const ctx = ctxRef.current ?? new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;
      await ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      mediaRef.current = stream;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        let sum = 0;
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i] ?? 0));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          sum += s * s;
        }
        const next = Math.min(1, Math.sqrt(sum / input.length) * 4);
        setLevel((prev) => (Math.abs(prev - next) < 0.04 ? prev : next));
        if (statusRef.current === "speaking" || statusRef.current === "thinking") return;
        ws.send(
          JSON.stringify({ type: "audio", sampleRate: ctx.sampleRate, pcm: pcmToBase64(pcm) }),
        );
      };
    } catch (err) {
      setError(`Sin micrófono (${String(err)}). Escribe el turno abajo; el debug sigue activo.`);
    }
  }, [hangUp, playWav, refreshDebug, speakLocal]);

  const sendText = useCallback(() => {
    const text = draft.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setDraft("");
  }, [draft]);

  useEffect(() => {
    return () => hangUp();
  }, [hangUp]);

  const lastError =
    error ?? selected?.lastError ?? calls.find((call) => call.lastError)?.lastError ?? null;
  const rateLimited = isRateLimit(lastError ?? "");

  async function copyLog() {
    const payload = selected ?? { calls };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }

  return (
    <main className="mx-auto grid h-dvh max-w-7xl grid-cols-1 grid-rows-[auto_minmax(0,1fr)_minmax(220px,0.95fr)] gap-3 overflow-hidden p-4 min-[960px]:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] min-[960px]:grid-rows-[auto_minmax(0,1fr)]">
      <Card className="min-[960px]:col-span-2">
        <CardHeader className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
                Debugger de llamadas
              </p>
              <CardTitle className="text-lg">Clínica Arenal · lab</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={health.ok ? "default" : "destructive"}>
                {health.ok ? "Agente up" : "Agente down"}
              </Badge>
              <Badge variant={health.gateway ? "default" : "secondary"}>
                Gateway {health.gateway ? "key" : "—"}
              </Badge>
              <Badge variant={health.clinic ? "default" : "secondary"}>
                Clínica {health.clinic ? "key" : "—"}
              </Badge>
              <Badge variant={live ? "default" : "secondary"}>{statusLabel(status, live)}</Badge>
              <Button size="sm" variant="outline" onClick={() => void refreshHealth()}>
                <RefreshCw className="size-3.5" />
                Recheck
              </Button>
            </div>
          </div>
          <CardDescription className="font-mono text-xs">
            {health.detail} · WS {WS_URL} · voz nova / tts-1-hd. El timeline sigue mostrando STT, LLM y tools.
          </CardDescription>
          {rateLimited && (
            <div className="bg-destructive/10 text-destructive mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                AI Gateway está en rate limit (tier gratis). El saludo local funciona; directory y
                generateText no hasta recargar créditos.{" "}
                {lastError ? <span className="font-mono text-xs">{lastError.slice(0, 180)}</span> : null}
              </p>
            </div>
          )}
          {!rateLimited && lastError && (
            <p className="text-destructive mt-2 font-mono text-xs">{lastError}</p>
          )}
        </CardHeader>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="shrink-0 space-y-3">
          <div className="flex items-center gap-3">
            <Button
              variant={live ? "destructive" : "default"}
              onClick={() => (live ? hangUp() : void connect().catch((err) => setError(String(err))))}
            >
              {live ? <PhoneOff className="size-4" /> : <Phone className="size-4" />}
              {live ? "Colgar" : "Llamar"}
            </Button>
            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full transition-[width] duration-75"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <audio ref={audioRef} className="sr-only" />
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border">
            <ScrollArea className="h-full overflow-hidden">
              <div className="space-y-3 p-4">
                {lines.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    El transcript aparece aquí. Si el debug de la derecha no se mueve al llamar, el
                    WebSocket no está llegando al agente.
                  </p>
                )}
                {lines.map((line) => (
                  <article
                    key={line.id}
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      line.role === "assistant"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted ml-auto"
                    }`}
                  >
                    <p className="mb-1 text-[10px] tracking-widest uppercase opacity-70">
                      {line.role === "assistant" ? "Recepción" : "Tú"}
                    </p>
                    {line.text}
                  </article>
                ))}
                <div ref={chatEndRef} />
              </div>
            </ScrollArea>
          </div>
          <form
            className="flex shrink-0 flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              sendText();
            }}
          >
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={!live}
                placeholder={live ? "Escribe un turno (recomendado mientras hay 429)" : "Llama primero"}
              />
              <Button type="submit" disabled={!live || !draft.trim()}>
                Enviar
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!live}
              onClick={() => setDraft(JOSEFA)}
            >
              Pegar caso Josefa
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
        <Tabs defaultValue="timeline" className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <p className="text-[10px] tracking-[0.2em] text-zinc-400 uppercase">Trazas</p>
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="calls">Llamadas</TabsTrigger>
              <TabsTrigger value="tools">Tools</TabsTrigger>
              <TabsTrigger value="state">Estado</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="timeline" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/10 px-3 py-2">
              {FILTERS.map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={filter === item ? "default" : "ghost"}
                  className="h-7 px-2 text-[11px] text-zinc-100"
                  onClick={() => setFilter(item)}
                >
                  {item}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-zinc-300"
                onClick={() => void copyLog()}
              >
                <Copy className="size-3.5" />
                JSON
              </Button>
            </div>
            <p className="shrink-0 px-3 py-2 font-mono text-[11px] text-zinc-500">
              {selected
                ? `${selected.kind} · ${selected.id} · ${selected.events.length} eventos${selected.endedAt ? " · cerrada" : " · abierta"}`
                : "Sin llamadas todavía. Pulsa Llamar o espera un socket."}
            </p>
            <Separator className="bg-white/10" />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-0 p-3 font-mono text-[11px] leading-relaxed">
                {visibleEvents.length === 0 && (
                  <p className="text-sm text-zinc-400">
                    Vacío. Si el agente está up y llamas, aquí tienen que salir hello, inbound text,
                    llm y errores 429. Si no sale nada, el click no abre el WS.
                  </p>
                )}
                {visibleEvents.map((event, index) => {
                  const key = `${event.t}-${index}`;
                  const open = openEvent === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="block w-full border-b border-white/5 py-2 text-left"
                      onClick={() => setOpenEvent(open ? null : key)}
                    >
                      <p>
                        <span className="text-zinc-500">{clock(event.t)}</span>{" "}
                        <span className="text-zinc-600">{event.source}</span>{" "}
                        <span className={stageClass(event)}>{event.stage ?? event.type}</span>
                        {event.ms != null && <span className="text-amber-200"> {event.ms}ms</span>}
                      </p>
                      <p className="text-zinc-200">{event.message}</p>
                      {open && event.data !== undefined && (
                        <pre className="mt-1 max-h-48 overflow-auto text-zinc-400">
                          {typeof event.data === "string"
                            ? event.data
                            : JSON.stringify(event.data, null, 2)}
                        </pre>
                      )}
                    </button>
                  );
                })}
                <div ref={debugEndRef} />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="calls" className="mt-0 min-h-0 flex-1 overflow-y-auto p-3">
            {calls.length === 0 && <p className="text-sm text-zinc-400">Ningún socket registrado.</p>}
            <div className="space-y-2">
              {calls.map((call) => (
                <button
                  key={call.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(call.id);
                  }}
                  className={`w-full rounded-xl border px-3 py-2 text-left font-mono text-[11px] ${
                    selected?.id === call.id ? "border-emerald-400/60 bg-white/10" : "border-white/10"
                  }`}
                >
                  <p className="text-zinc-200">{call.id}</p>
                  <p className="text-zinc-500">
                    {call.kind} · {clock(call.startedAt)} · {call.events.length} ev
                    {call.lastError ? " · ERROR" : ""}
                  </p>
                  {call.lastError && <p className="mt-1 text-red-400">{call.lastError.slice(0, 160)}</p>}
                </button>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="tools" className="mt-0 min-h-0 flex-1 overflow-y-auto p-3">
            {tools.length === 0 && (
              <p className="text-sm text-zinc-400">
                Las tools de esta sesión en vivo. También quedan en el timeline (filtro tool).
              </p>
            )}
            {tools.map((tool) => (
              <div key={tool.id} className="mb-3 rounded-xl bg-white/5 p-3">
                <p className="font-mono text-xs text-emerald-300">
                  {tool.name}
                  {tool.ms != null ? ` · ${tool.ms}ms` : ""}
                </p>
                <pre className="mt-2 max-h-40 overflow-auto text-[11px] text-zinc-200">
                  {JSON.stringify({ in: tool.input, out: tool.output }, null, 2)}
                </pre>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="state" className="mt-0 min-h-0 flex-1 overflow-y-auto p-3">
            {latestState === undefined ? (
              <p className="text-sm text-zinc-400">Todavía no hay estado estructurado.</p>
            ) : (
              <pre className="overflow-auto rounded-xl bg-white/5 p-3 text-[11px] text-cyan-100">
                {JSON.stringify(latestState, null, 2)}
              </pre>
            )}
          </TabsContent>
        </Tabs>
      </Card>
    </main>
  );
}
