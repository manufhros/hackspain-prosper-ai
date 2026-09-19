"use client";

import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useTeam } from "@/lib/prosper-hooks";

// Colores HackSpain para confeti, globos y luces
const COLORS = ["#d96b2a", "#eab619", "#35858a", "#cc291f", "#1e3958", "#f4ecd8"];

// Suelta aquí tu pista épica (Two Steps from Hell u otra) si la tienes con licencia:
//   web/public/epic.mp3  →  suena automáticamente en vez del sintetizador.
const EPIC_SRC = "/epic.mp3";

type Balloon = { id: number; left: number; color: string; delay: number; drift: number; size: number };
type Car = { id: number; bottom: number; delay: number; dur: number };
type Party = { id: number; amount: number } | null;

const runPoints = (r: { cases: { points: number | null }[] }) => r.cases.reduce((n, c) => n + (c.points ?? 0), 0);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Celebration() {
  const { data } = useTeam();
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [party, setParty] = useState<Party>(null);
  const seed = useRef(0);
  const prev = useRef<Map<string, number> | null>(null);
  const record = useRef<number>(0);
  const themeRef = useRef<HTMLAudioElement | null>(null);

  // ── Confeti + globos, escalados por intensidad (0..1) ─────────────
  const fireConfetti = (intensity: number) => {
    const count = 50 + Math.round(intensity * 180);
    const shoot = (ratio: number, opts: confetti.Options) =>
      confetti({ ...opts, colors: COLORS, disableForReducedMotion: true, particleCount: Math.floor(count * ratio), zIndex: 100 });
    shoot(0.5, { origin: { x: 0, y: 1 }, angle: 60, spread: 55, startVelocity: 55 });
    shoot(0.5, { origin: { x: 1, y: 1 }, angle: 120, spread: 55, startVelocity: 55 });
    shoot(0.35, { origin: { x: 0.5, y: 0.6 }, spread: 100, startVelocity: 35, scalar: 1.1 });
  };

  const launchBalloons = (intensity: number) => {
    const n = 5 + Math.round(intensity * 16);
    const next: Balloon[] = Array.from({ length: n }, () => ({
      id: seed.current++,
      left: Math.random() * 92 + 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      delay: Math.random() * 0.5,
      drift: (Math.random() - 0.5) * 80,
      size: Math.random() * 20 + 40,
    }));
    setBalloons((b) => [...b, ...next]);
    const ids = new Set(next.map((x) => x.id));
    window.setTimeout(() => setBalloons((b) => b.filter((x) => !ids.has(x.id))), 5000);
  };

  const celebrate = (intensity: number) => {
    fireConfetti(intensity);
    launchBalloons(intensity);
    playTheme(intensity, false);
  };

  // ── Apoteosis (récord batido): fuegos, disco, coches ─────────────
  const fireworks = (durationMs: number, intensity: number) => {
    const end = Date.now() + durationMs;
    const n = 4 + Math.round(intensity * 6);
    const tick = () => {
      confetti({ particleCount: n, angle: 60, spread: 70, startVelocity: 60, origin: { x: 0, y: 0.9 }, colors: COLORS, zIndex: 100 });
      confetti({ particleCount: n, angle: 120, spread: 70, startVelocity: 60, origin: { x: 1, y: 0.9 }, colors: COLORS, zIndex: 100 });
      // Estallido tipo fuego artificial en un punto aleatorio del cielo
      confetti({ particleCount: 30 + Math.round(intensity * 30), spread: 360, startVelocity: 32, ticks: 90, gravity: 0.9, scalar: 1.2, origin: { x: Math.random(), y: Math.random() * 0.5 }, colors: COLORS, zIndex: 100 });
      if (Date.now() < end) requestAnimationFrame(tick);
    };
    tick();
  };

  // Intenta tu pista (public/epic.mp3); si no existe, cae al sintetizador.
  // `full` = récord batido (más volumen y duración). `intensity` 0..1.
  const playTheme = (intensity: number, full: boolean) => {
    if (reduced()) return;
    const prevEl = themeRef.current;
    if (prevEl) {
      prevEl.pause();
      themeRef.current = null;
    }
    const a = new Audio(EPIC_SRC);
    a.volume = 0;
    themeRef.current = a;
    a
      .play()
      .then(() => {
        // Archivo disponible: fundido de entrada progresivo por intensidad
        const target = Math.min(1, 0.3 + 0.7 * intensity);
        const t0 = performance.now();
        const fadeIn = () => {
          if (themeRef.current !== a) return;
          const k = Math.min(1, (performance.now() - t0) / 1400);
          a.volume = target * k;
          if (k < 1) requestAnimationFrame(fadeIn);
        };
        fadeIn();
        // Corte con fundido de salida al terminar la fiesta
        window.setTimeout(() => {
          if (themeRef.current !== a) return;
          const v0 = a.volume;
          const s0 = performance.now();
          const fadeOut = () => {
            if (themeRef.current !== a) return;
            const k = Math.min(1, (performance.now() - s0) / 900);
            a.volume = v0 * (1 - k);
            if (k < 1) requestAnimationFrame(fadeOut);
            else {
              a.pause();
              themeRef.current = null;
            }
          };
          fadeOut();
        }, full ? 8000 : 3200);
      })
      .catch(() => {
        themeRef.current = null;
        synthEpic(intensity, full); // sin archivo → cue orquestal sintetizado
      });
  };

  // Cue orquestal tipo tráiler, construido por capas según intensidad/`full`.
  const synthEpic = (intensity: number, full: boolean) => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const now = ctx.currentTime;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 12;
      const master = ctx.createGain();
      master.gain.value = 0.5 + 0.5 * intensity;
      comp.connect(master).connect(ctx.destination);

      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const burst = (at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, vol: number) => {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(f0, at);
        f.frequency.exponentialRampToValueAtTime(f1, at + dur);
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        src.connect(f).connect(g).connect(comp);
        src.start(at);
        src.stop(at + dur);
      };
      const tone = (at: number, dur: number, type: OscillatorType, f0: number, f1: number, vol: number, detune = 0) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.detune.value = detune;
        o.frequency.setValueAtTime(f0, at);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.06, dur * 0.2));
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g).connect(comp);
        o.start(at);
        o.stop(at + dur + 0.05);
      };
      const taiko = (at: number, vol: number) => tone(at, 0.35, "sine", 150, 45, vol);

      // ── Capa 1: drone grave + cuerdas que suben (siempre) ──────────
      tone(now, full ? 3 : 1.4, "sawtooth", 65, 65, 0.06 + 0.06 * intensity);
      tone(now, full ? 3 : 1.4, "sawtooth", 98, 130, 0.05 + 0.05 * intensity, 4); // string swell subiendo

      if (!full) {
        // Subida normal: un taiko y un pequeño acento, discreto
        taiko(now + 0.1, 0.4 + 0.3 * intensity);
        tone(now + 0.15, 0.7, "triangle", 392, 523, 0.06 + 0.05 * intensity);
        window.setTimeout(() => ctx.close(), 2200);
        return;
      }

      // ── Récord: build completo (≈7 s) ──────────────────────────────
      // Capa 2: ostinato de taikos acelerando hacia el golpe
      [0, 0.5, 0.9, 1.25, 1.55, 1.8, 2.0].forEach((t, i) => taiko(now + t, 0.4 + i * 0.06));
      // Riser + platillo hacia el impacto
      burst(now + 1.2, 1.5, "bandpass", 800, 3600, 6, 0.3);
      // Capa 3: IMPACTO en 2.1s — braam grave + sub + crash
      tone(now + 2.1, 1.4, "sine", 150, 40, 1.0);
      tone(now + 2.1, 1.3, "sawtooth", 55, 55, 0.5); // braam de metales graves
      burst(now + 2.1, 0.8, "lowpass", 400, 80, 1, 0.55);
      burst(now + 2.1, 1.8, "highpass", 6000, 9000, 0.7, 0.4);
      // Capa 4: tema principal de metales (acorde mayor con octava/quinta)
      const chord = [261.6, 329.6, 392.0, 523.3, 784.0]; // C E G C5 G5
      chord.forEach((f, i) => {
        const at = now + 2.35 + i * 0.05;
        tone(at, 2.2, "sawtooth", f, f, 0.13, -6);
        tone(at, 2.2, "square", f, f, 0.06, +6);
      });
      // Taikos marcando el tema
      [2.4, 2.9, 3.4, 3.9, 4.4, 4.9].forEach((t) => taiko(now + t, 0.7));
      // Capa 5: remate — quinta que sube una octava + crash final
      tone(now + 5.2, 1.4, "sawtooth", 392, 784, 0.14);
      tone(now + 5.2, 1.4, "square", 523, 1046, 0.08);
      burst(now + 5.2, 1.6, "highpass", 7000, 11000, 0.7, 0.35);

      window.setTimeout(() => ctx.close(), 7500);
    } catch {
      /* audio no disponible: seguimos sin sonido */
    }
  };

  const apotheosis = (amount: number) => {
    fireConfetti(1);
    launchBalloons(1);
    if (reduced()) {
      setParty({ id: seed.current++, amount });
      window.setTimeout(() => setParty(null), 4000);
      return;
    }
    playTheme(1, true); // tema completo
    // Los fuegos entran tras el "impacto" musical (~2.1 s) y duran hasta el final
    window.setTimeout(() => fireworks(5200, 1), 1900);
    const carList: Car[] = [
      { id: seed.current++, bottom: 8, delay: 2.0, dur: 2.2 },
      { id: seed.current++, bottom: 20, delay: 2.4, dur: 2.6 },
      { id: seed.current++, bottom: 2, delay: 3.0, dur: 2 },
    ];
    setCars(carList);
    const carIds = new Set(carList.map((c) => c.id));
    window.setTimeout(() => setCars((c) => c.filter((x) => !carIds.has(x.id))), 7200);
    setParty({ id: seed.current++, amount });
    window.setTimeout(() => setParty(null), 8000);
  };

  // ── Detección en cada refresco ───────────────────────────────────
  useEffect(() => {
    if (!data) return;
    const cur = new Map(data.runs.map((r) => [r.run_id, runPoints(r)]));
    const maxNow = Math.max(0, ...cur.values());
    if (prev.current === null) {
      prev.current = cur;
      record.current = Math.max(data.stats.best_points ?? 0, maxNow);
      return;
    }
    let delta = 0;
    for (const [id, pts] of cur) {
      const before = prev.current.get(id) ?? 0;
      if (pts > before) delta += pts - before;
    }
    prev.current = cur;
    if (maxNow > record.current) {
      const over = maxNow - record.current;
      record.current = maxNow;
      apotheosis(over); // ¡nuevo récord!
    } else if (delta > 0) {
      // Progresivo: cuanto más cerca del récord, más épico
      const intensity = Math.max(0.15, Math.min(1, maxNow / Math.max(record.current, 1)));
      celebrate(intensity);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <>
      {/* Discoteca: haces giratorios + estrobo */}
      {party && !reduced() && (
        <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden>
          <div
            className="hs-party-motion absolute left-1/2 top-1/2 h-[200vmax] w-[200vmax] -translate-x-1/2 -translate-y-1/2 opacity-25 mix-blend-multiply"
            style={{
              background:
                "conic-gradient(from 0deg, #d96b2a 0 30deg, transparent 30deg 60deg, #35858a 60deg 90deg, transparent 90deg 120deg, #eab619 120deg 150deg, transparent 150deg 180deg, #cc291f 180deg 210deg, transparent 210deg 240deg, #1e3958 240deg 270deg, transparent 270deg 300deg, #d96b2a 300deg 330deg, transparent 330deg)",
              animation: "hs-disco-spin 6s linear infinite",
            }}
          />
          <div className="hs-party-motion absolute inset-0 bg-hs-yellow" style={{ animation: "hs-strobe 0.35s steps(1) infinite" }} />
        </div>
      )}

      {/* Cartel de récord */}
      {party && (
        <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center" aria-hidden>
          <div
            className="hs-party-motion absolute left-1/2 top-1/2 border-4 border-foreground bg-primary px-8 py-5 text-center shadow-[8px_8px_0_var(--hs-ink)]"
            style={{ animation: "hs-record-pop 6.1s ease-out 1.9s both" }}
          >
            <div className="font-heading text-2xl uppercase tracking-wide text-hs-red">¡Nuevo récord!</div>
            <div className="font-heading text-6xl leading-none text-foreground">+{party.amount}</div>
            <div className="mt-1 font-heading text-xs uppercase tracking-widest text-muted-foreground">puntos · a tope</div>
          </div>
        </div>
      )}

      {/* Coches derrapando */}
      {cars.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-[85] overflow-hidden" aria-hidden>
          {cars.map((c) => (
            <div
              key={c.id}
              className="hs-party-motion absolute text-5xl"
              style={{ bottom: `${c.bottom}vh`, left: 0, animation: `hs-car-drift ${c.dur}s cubic-bezier(0.4, 0, 0.2, 1) ${c.delay}s forwards` }}
            >
              <span className="hs-party-motion inline-block" style={{ animation: "hs-skid 0.4s ease-in-out infinite" }}>
                🏎️
              </span>
              <span className="absolute right-full top-1/2 h-1 w-24 -translate-y-1 bg-gradient-to-l from-hs-ink/50 to-transparent" />
            </div>
          ))}
        </div>
      )}

      {/* Globos */}
      {balloons.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden" aria-hidden>
          {balloons.map((b) => (
            <div
              key={b.id}
              className="hs-party-motion absolute bottom-[-140px]"
              style={{
                left: `${b.left}%`,
                // @ts-expect-error propiedad CSS personalizada para el keyframe
                "--drift": `${b.drift}px`,
                animation: `hs-balloon-up 4.5s ease-in ${b.delay}s forwards`,
              }}
            >
              <div
                className="relative border-2 border-foreground"
                style={{ width: b.size, height: b.size * 1.2, background: b.color, borderRadius: "50% 50% 48% 48%" }}
              >
                <span className="absolute left-1/2 top-2 h-3 w-2 -translate-x-1/2 rounded-full bg-white/40" />
                <span className="absolute left-1/2 top-full h-16 w-px -translate-x-1/2" style={{ background: "var(--hs-ink)" }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
