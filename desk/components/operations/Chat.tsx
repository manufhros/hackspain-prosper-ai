"use client";
import { useEffect, useRef, useState } from "react";
import { Headphones, UserRound, ArrowDown, Terminal, MessageSquare } from "lucide-react";
import { Avatar, AvatarFallback } from "./components/avatar";
import { ScrollArea } from "./components/scroll-area";
import { Button } from "./components/button";
import { Badge } from "./components/badge";
import { Separator } from "./components/separator";
import { duration, toolLabels, type Call } from "./types";
import styles from "./Operations.module.css";

export function Chat({ call }: { call?: Call }) {
  const language = call?.events.findLast(event => event.type === "user" && event.language)?.language;
  const area = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const viewport = area.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) return;
    if (follow.current) viewport.scrollTop = viewport.scrollHeight;
    const scroll = () => { follow.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80; setAway(!follow.current); };
    viewport.addEventListener("scroll", scroll);
    return () => viewport.removeEventListener("scroll", scroll);
  }, [call?.events.length]);
  return <section className={styles.chat} aria-label="Conversación">
    <header className={styles.chatHeader}><Avatar className="h-9 w-9 rounded-md"><AvatarFallback><Headphones size={17}/></AvatarFallback></Avatar>
      <div><h2>{call?.name ?? "Conversación"} {language && <span className={styles.flag} title={language}>{language === "es" ? "🇪🇸" : language === "fr" ? "🇫🇷" : "🇬🇧"}</span>}</h2><p>{call ? (call.source === "mock" ? "Simulación local" : `ElevenLabs · ${call.source === "phone" ? "Teléfono" : "Paciente LLM · texto"}`) : "Selecciona una llamada"}</p></div>
      {call && <Badge variant="outline">{call.state}</Badge>}
    </header><Separator/>
    <div className={styles.chatBody}><ScrollArea ref={area} className="h-full">
      <div className={styles.messages} role="log" aria-label="Transcripción">
        {!call?.events.length && <div className={styles.empty}><MessageSquare size={28}/><p>La transcripción aparecerá aquí</p></div>}
        {call?.events.map((event, index) => ["agent", "user"].includes(event.type) ?
          <article key={index} className={event.type === "user" ? styles.patient : styles.agent}>
            <Avatar className="h-7 w-7"><AvatarFallback>{event.type === "agent" ? <Headphones size={14}/> : <UserRound size={14}/>}</AvatarFallback></Avatar>
            <div><div className={styles.messageMeta}><strong>{event.type === "agent" ? "Agente" : call.name}</strong><time>{duration(call.started, event.at)}</time></div><p>{event.text}</p></div>
          </article> :
          <div key={index} className={styles.event}><Terminal size={13}/><span>{event.type === "ready" ? "Agente conectado" : event.text || toolLabels[event.name ?? ""] || event.name || event.type}</span><time>{duration(call.started, event.at)}</time></div>)}
      </div>
    </ScrollArea>{away && <Button className={styles.jump} variant="outline" size="sm" onClick={() => {
      const viewport = area.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
      viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }}><ArrowDown/>Últimos mensajes</Button>}</div>
    <Separator/><footer className={styles.chatFooter}>Transcripción y decisiones del agente</footer>
  </section>;
}
