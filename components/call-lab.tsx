"use client";

import { useMemo, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { AgentTranscript } from "@/components/agent-transcript";
import { ToolLog } from "@/components/tool-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runCaseCall } from "@/lib/voice/case-session";
import { agentAvatarUrl, patientAvatarUrl } from "@/lib/avatars";
import type { TranscriptTurn } from "@/lib/cases/transcript";

export type SimCase = {
  id: string;
  problem_id: string;
  language: string;
  summary: string;
  name: string;
  voice?: string;
  phone?: string;
  expected: string[];
};

type Phase = "idle" | "ringing" | "live";
type Mode = "llm" | "voice";

const DEFAULT_VOICE_WS = "wss://b5f4-86-127-225-103.ngrok-free.app/ws";

function pauseMs() {
  return 3000;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function CallLab({ cases }: { cases: SimCase[] }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState<SimCase | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [typing, setTyping] = useState<"agent" | "patient" | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const [mode, setMode] = useState<Mode>("llm");
  const [voiceUrl, setVoiceUrl] = useState(DEFAULT_VOICE_WS);
  const [selectedId, setSelectedId] = useState(cases[0]?.id ?? "");

  const patientUrl = current ? patientAvatarUrl(current.name, current.voice) : "";
  const agentUrl = agentAvatarUrl();

  const tldr = useMemo(() => {
    if (!current) return "";
    return current.summary || `${current.name} is calling about a clinic appointment.`;
  }, [current]);

  function pick(item?: SimCase) {
    const next = item ?? cases.find((row) => row.id === selectedId) ?? cases[0];
    if (!next) return;
    setCurrent(next);
    setTurns([]);
    setTyping(null);
    setStatus("Incoming call");
    setPhase("ringing");
  }

  async function answer() {
    if (!current) return;
    setPhase("live");
    setBusy(true);
    setStatus("Connecting…");
    setTurns([]);
    setTyping(null);
    const controller = new AbortController();
    setAbort(controller);
    try {
      if (mode === "voice") {
        await runVoice(controller);
      } else {
        await runLlm(controller);
      }
      if (!controller.signal.aborted) setStatus("Llamada terminada");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus(error instanceof Error ? error.message : "simulation failed");
    } finally {
      setBusy(false);
      setAbort(null);
    }
  }

  async function consumeNdjson(response: Response, controller: AbortController, paceMessages: boolean) {
    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || response.statusText);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as {
          type: string;
          status?: string;
          error?: string;
          turn?: TranscriptTurn;
        };
        if (event.type === "status" && event.status) {
          setStatus(event.status);
        }
        if (event.type === "turn" && event.turn) {
          setTyping(null);
          setTurns((currentTurns) => [...currentTurns, event.turn!]);
          if (paceMessages && event.turn.kind === "message") {
            await sleep(pauseMs(), controller.signal);
          }
        }
        if (event.type === "error") throw new Error(event.error || "simulation failed");
      }
    }
  }

  async function runLlm(controller: AbortController) {
    setStatus("En llamada");
    setTyping("agent");
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: current?.id }),
      signal: controller.signal,
    });
    await consumeNdjson(response, controller, true);
  }

  async function runVoice(controller: AbortController) {
    if (!current) return;
    setStatus("Llamando al agente…");
    await runCaseCall({
      caseId: current.id,
      endpoint: voiceUrl,
      phone: current.phone,
      signal: controller.signal,
      handlers: {
        onStatus: (next) => setStatus(next),
        onTurn: (turn) => {
          setTyping(null);
          setTurns((currentTurns) => [...currentTurns, turn]);
        },
        onTrace: (next) => {
          setTyping(null);
          setTurns(next);
        },
      },
    });
  }

  function hangup() {
    if (phase === "ringing" || !abort) {
      setPhase("idle");
      setBusy(false);
      setTyping(null);
      setStatus("");
      return;
    }
    abort.abort();
    setBusy(false);
    setTyping(null);
    setStatus("Colgando…");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl tracking-tight">Pruebas</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            En LLM se simula el caso en texto. En agente de voz el caso habla por TTS contra el WebSocket; la auditoría sale de ElevenLabs.
          </p>
        </div>
        <div className="grid min-w-64 gap-2">
          <Label>Modalidad</Label>
          <Select value={mode} onValueChange={(value) => setMode(String(value) as Mode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="llm">LLM (AI Gateway)</SelectItem>
              <SelectItem value="voice">Agente de voz (caso + TTS)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {mode === "voice" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="voice-ws">Endpoint Twilio /ws</Label>
            <Input
              id="voice-ws"
              value={voiceUrl}
              onChange={(event) => setVoiceUrl(event.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label>Caso</Label>
            <Select value={selectedId} onValueChange={(value) => setSelectedId(String(value))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cases.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.problem_id} · {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <div className="space-y-1 sm:max-w-md">
          <Label>Caso</Label>
          <Select value={selectedId} onValueChange={(value) => setSelectedId(String(value))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cases.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.problem_id} · {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
              {phase === "idle" ? (
                <div className="space-y-3 py-8 text-sm text-muted-foreground">
                  <p>No one is on the line.</p>
                  <Button nativeButton onClick={() => pick()}>
                    {mode === "voice" ? "Llamar con el caso" : "Simulate a call"}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative size-28">
                    {phase === "ringing" ? (
                      <>
                        <span className="incoming-ring absolute inset-0 rounded-full bg-primary/40" />
                        <span className="incoming-ring absolute inset-0 rounded-full bg-primary/30 [animation-delay:400ms]" />
                      </>
                    ) : null}
                    <img
                      src={patientUrl}
                      alt={current?.name}
                      className="relative size-28 rounded-full bg-muted ring-2 ring-background"
                    />
                  </div>
                  <div className="didactic-in space-y-1">
                    <div className="text-lg font-medium">{current?.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {current?.phone ?? "unknown number"}
                    </div>
                    <Badge variant={phase === "ringing" ? "default" : "secondary"}>
                      {status}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    {phase === "ringing" ? (
                      <Button nativeButton onClick={() => void answer()}>
                        <Phone className="size-4" />
                        {mode === "voice" ? "Descolgar" : "Answer"}
                      </Button>
                    ) : null}
                    <Button nativeButton variant="outline" onClick={hangup}>
                      <PhoneOff className="size-4" />
                      Hang up
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {current && phase !== "idle" ? (
            <Card className="didactic-in">
              <CardHeader>
                <CardTitle>TL;DR</CardTitle>
                <CardDescription className="font-mono">{current.problem_id}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{tldr}</p>
                <p className="text-muted-foreground">
                  Expected: {current.expected.join(" + ") || "—"}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="overflow-anchor-none">
          <CardHeader>
            <CardTitle>Conversación</CardTitle>
            <CardDescription>
              {phase === "live"
                ? mode === "voice"
                  ? "El caso habla por TTS. Oyes a Marta. Tools desde ElevenLabs."
                  : "Cada frase espera 3 segundos y aparece entera."
                : "Contesta para ver la conversación."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {phase === "idle" ? (
              <p className="text-sm text-muted-foreground">No hay llamada en curso.</p>
            ) : (
              <AgentTranscript
                turns={turns}
                typing={phase === "live" ? typing : null}
                agentName="Marta"
                patientName={current?.name ?? "Caller"}
                agentAvatar={agentUrl}
                patientAvatar={patientUrl}
              />
            )}
          </CardContent>
        </Card>
        {phase !== "idle" ? (
          <Card>
            <CardHeader className="xl:sr-only">
              <CardTitle>Auditoría</CardTitle>
            </CardHeader>
            <CardContent>
              <ToolLog turns={turns} />
            </CardContent>
          </Card>
        ) : (
          <Card className="hidden xl:block">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Aquí verás cada consulta al ERP cuando empiece la llamada.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
