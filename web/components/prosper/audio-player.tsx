"use client";

import { useState, type RefObject } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const SPEEDS = [1, 1.5, 2];

// <audio> oculto + controles propios con el estilo HackSpain.
// El padre controla el elemento a través de `audioRef` (seek desde el transcript).
export function AudioPlayer({
  src,
  audioRef,
  onTime,
}: {
  src: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  onTime?: (t: number) => void;
}) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration;
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 border-[3px] border-foreground bg-card p-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTime?.(e.currentTarget.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar" : "Reproducir"}
        className="flex size-10 shrink-0 items-center justify-center border-2 border-foreground bg-primary text-foreground transition-transform hover:bg-hs-orange hover:text-hs-cream active:translate-y-px"
      >
        {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
      </button>

      <span className="w-24 shrink-0 font-heading text-xs tabular-nums">
        {fmt(time)} <span className="text-muted-foreground">/ {fmt(duration)}</span>
      </span>

      <div
        role="slider"
        aria-label="Posición"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        tabIndex={0}
        onClick={seekTo}
        onKeyDown={(e) => {
          const a = audioRef.current;
          if (!a) return;
          if (e.key === "ArrowRight") a.currentTime += 5;
          if (e.key === "ArrowLeft") a.currentTime -= 5;
        }}
        className="relative h-4 flex-1 cursor-pointer border-2 border-foreground bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="h-full bg-hs-teal" style={{ width: `${pct}%` }} />
        <div
          className={cn("absolute top-1/2 h-6 w-2 -translate-y-1/2 border-2 border-foreground bg-hs-orange")}
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        aria-label="Velocidad"
        className="w-12 shrink-0 border-2 border-foreground bg-background py-1 font-heading text-[11px] hover:bg-primary"
      >
        {speed}x
      </button>
    </div>
  );
}
