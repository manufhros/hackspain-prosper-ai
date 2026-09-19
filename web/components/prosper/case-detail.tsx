"use client";

import { useRef, useState } from "react";
import { Bot, Check, User, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prosper } from "@/lib/prosper-client";
import type { CallNote, Case, Submission } from "@/lib/prosper-types";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "./audio-player";
import { AttributionBadge, StatusBadge } from "./badges";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function CaseDetail({ c, submission, note }: { c: Case; submission?: Submission; note?: CallNote }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);

  // La línea activa es la última cuyo `seconds` ya pasó
  let active = -1;
  c.transcript.forEach((l, i) => {
    if (l.seconds <= now) active = i;
  });

  const seek = (s: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = s;
    void a.play();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{c.label}</h2>
        <span className="font-mono text-xs text-muted-foreground">{c.call_id.slice(0, 8)}</span>
        <StatusBadge status={c.status} />
        <AttributionBadge value={c.attribution} />
        {c.hidden && <Badge variant="secondary">hidden</Badge>}
        {c.points_available != null && (
          <span className="ml-auto text-sm text-muted-foreground">
            {c.points ?? "—"} / {c.points_available} pts
          </span>
        )}
      </div>

      {c.signal_codes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {c.signal_codes.map((s) => (
            <Badge key={s} variant="outline" className="font-mono text-xs">
              {s}
            </Badge>
          ))}
        </div>
      )}

      {note && (
        <Card className="border-hs-orange">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              Nota del análisis <Badge variant="outline">{note.verdict}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{note.note}</CardContent>
        </Card>
      )}

      {c.hidden && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Caso privado (Run All)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Prosper no publica transcript, audio ni campos esperados de los casos privados. Solo se conoce lo que envió
              nuestro agente y el veredicto.
            </p>
            {submission ? (
              <div className="rounded bg-muted p-2 font-mono text-xs">
                {submission.outcome}: {submission.detail}
              </div>
            ) : c.status === "active" ? (
              <p className="text-xs text-muted-foreground">Llamada en curso: aún no hay submission.</p>
            ) : (
              <p className="text-xs text-hs-orange">Sin submission registrada para esta llamada.</p>
            )}
          </CardContent>
        </Card>
      )}

      {c.fields.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Esperado vs enviado</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campo</TableHead>
                  <TableHead>Esperado</TableHead>
                  <TableHead>Enviado</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.fields.map((f) => (
                  <TableRow key={f.field} className={cn(!f.matched && "bg-hs-red/10")}>
                    <TableCell className="font-mono text-xs">{f.field}</TableCell>
                    <TableCell className="font-mono text-xs">{f.expected}</TableCell>
                    <TableCell className={cn("font-mono text-xs", !f.matched && "text-hs-red")}>
                      {f.submitted ?? <em className="text-muted-foreground">sin submission</em>}
                    </TableCell>
                    <TableCell>
                      {f.matched ? <Check className="size-4 text-hs-teal" /> : <X className="size-4 text-hs-red" />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {c.has_audio && (
        <AudioPlayer key={c.call_id} src={prosper.audioUrl(c.call_id)} audioRef={audio} onTime={setNow} />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Conversación ({c.transcript.length} turnos)</CardTitle>
        </CardHeader>
        <CardContent>
          {c.transcript.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin transcript.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {c.transcript.map((l, i) => {
                const isAgent = l.speaker === "Agent";
                // Agrupar turnos seguidos del mismo interlocutor: avatar+cabecera solo en el primero
                const firstOfGroup = i === 0 || c.transcript[i - 1].speaker !== l.speaker;
                return (
                  <Message
                    key={i}
                    align={isAgent ? "start" : "end"}
                    className="hs-chat-in"
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                  >
                    <MessageAvatar
                      className={cn(
                        "size-8 rounded-none border-2 border-foreground font-heading text-xs",
                        isAgent ? "bg-hs-teal text-hs-cream" : "bg-hs-sand text-hs-ink",
                        !firstOfGroup && "invisible",
                      )}
                    >
                      {isAgent ? <Bot className="size-4" /> : <User className="size-4" />}
                    </MessageAvatar>
                    <MessageContent>
                      {firstOfGroup && (
                        <MessageHeader className={cn("gap-2", isAgent ? "justify-start" : "justify-end")}>
                          <span className="font-heading text-[10px] uppercase tracking-wide text-foreground">
                            {isAgent ? "Agente" : "Paciente"}
                          </span>
                          <span className="font-mono">{fmt(l.seconds)}</span>
                        </MessageHeader>
                      )}
                      <Bubble variant={isAgent ? "secondary" : "muted"} align={isAgent ? "start" : "end"}>
                        <BubbleContent
                          asChild
                          className={cn(
                            "rounded-none border-2 border-foreground transition-[background-color,box-shadow] duration-150",
                            i === active && "shadow-[3px_3px_0_var(--hs-orange)]",
                          )}
                        >
                          <button type="button" onClick={() => seek(l.seconds)} disabled={!c.has_audio}>
                            {l.text}
                          </button>
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
