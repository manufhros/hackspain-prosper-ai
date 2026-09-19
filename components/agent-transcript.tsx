"use client";

import { useLayoutEffect, useRef } from "react";
import { Bot, User, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import { explainTool } from "@/lib/tools/catalog";
import type { TranscriptTurn } from "@/lib/cases/transcript";

function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

export function AgentTranscript({
  turns,
  typing = null,
  agentName = "Agent",
  patientName = "Patient",
  agentAvatar,
  patientAvatar,
}: {
  turns: TranscriptTurn[];
  typing?: "agent" | "patient" | null;
  agentName?: string;
  patientName?: string;
  agentAvatar?: string;
  patientAvatar?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const visible = turns.filter((turn) => turn.kind === "message" || turn.kind === "tool");

  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node || !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [visible.length, typing]);

  if (!visible.length && !typing) {
    return <p className="text-sm text-muted-foreground">Aún no hay frases.</p>;
  }

  return (
    <div
      ref={scrollerRef}
      className="overflow-anchor-none max-h-[min(36rem,calc(100vh-14rem))] overflow-y-auto overscroll-contain rounded-xl border bg-background p-4"
      onScroll={(event) => {
        const node = event.currentTarget;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
    >
      <div className="flex flex-col gap-3">
        {visible.map((turn, index) => {
          if (turn.kind === "tool") {
            const info = explainTool(turn.name, turn.reason);
            const verb = info.name.startsWith("submit_") ? "Escribe en el ERP" : "Consulta el ERP";
            return (
              <div key={turn.id} className="didactic-in py-1">
                <Marker variant="separator">
                  <MarkerIcon>
                    <Wrench />
                  </MarkerIcon>
                  <MarkerContent>
                    {verb}: {info.label}
                  </MarkerContent>
                </Marker>
              </div>
            );
          }

          const previous = [...visible.slice(0, index)].reverse().find((item) => item.kind === "message");
          const firstOfGroup = previous?.kind !== "message" || previous.role !== turn.role;
          return (
            <div key={turn.id} className="didactic-in">
              <Message align={turn.role === "agent" ? "start" : "end"}>
                <MessageAvatar className={cn("size-8 overflow-hidden", !firstOfGroup && "invisible")}>
                  {turn.role === "agent" && agentAvatar ? (
                    <img src={agentAvatar} alt="" className="size-8" />
                  ) : turn.role === "patient" && patientAvatar ? (
                    <img src={patientAvatar} alt="" className="size-8" />
                  ) : turn.role === "agent" ? (
                    <Bot className="size-4" />
                  ) : (
                    <User className="size-4" />
                  )}
                </MessageAvatar>
                <MessageContent>
                  {firstOfGroup ? (
                    <MessageHeader>
                      {turn.role === "agent" ? agentName : patientName}
                      {turn.source === "voice-agent" ? (
                        <span className="ml-2 font-normal text-muted-foreground">audio</span>
                      ) : turn.source === "caller" ? (
                        <span className="ml-2 font-normal text-muted-foreground">caso</span>
                      ) : null}
                    </MessageHeader>
                  ) : null}
                  <Bubble
                    variant={turn.role === "agent" ? "muted" : "default"}
                    align={turn.role === "agent" ? "start" : "end"}
                  >
                    <BubbleContent className="whitespace-pre-wrap">{turn.text}</BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </div>
          );
        })}
        {typing ? (
          <div className="didactic-in">
            <Message align={typing === "agent" ? "start" : "end"}>
              <MessageAvatar className="size-8 overflow-hidden">
                {typing === "agent" && agentAvatar ? (
                  <img src={agentAvatar} alt="" className="size-8" />
                ) : typing === "patient" && patientAvatar ? (
                  <img src={patientAvatar} alt="" className="size-8" />
                ) : typing === "agent" ? (
                  <Bot className="size-4" />
                ) : (
                  <User className="size-4" />
                )}
              </MessageAvatar>
              <MessageContent>
                <MessageHeader>{typing === "agent" ? agentName : patientName}</MessageHeader>
                <Bubble
                  variant={typing === "agent" ? "muted" : "default"}
                  align={typing === "agent" ? "start" : "end"}
                >
                  <BubbleContent>
                    <TypingDots />
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          </div>
        ) : null}
      </div>
    </div>
  );
}
