"use client";

import { useId, useMemo, useState } from "react";
import type { PeakPoint } from "@/lib/reporting";
import styles from "./PeakChart.module.css";

const W = 800;
const H = 280;
const PAD = { l: 36, r: 14, t: 14, b: 34 };

const SERIES = [
  { key: "total" as const, label: "Llamadas", fill: "var(--brand-2)", fillOpacity: 0.18, stroke: "var(--brand-2)" },
  { key: "abierto" as const, label: "Sin cierre", fill: "var(--muted)", fillOpacity: 0.22, stroke: "var(--ink-2)" },
  { key: "escalado" as const, label: "Escalados", fill: "var(--danger)", fillOpacity: 0.28, stroke: "var(--danger)" },
];

function madridParts(iso: string) {
  const date = new Date(iso);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Madrid" }).format(date));
  const day = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", timeZone: "Europe/Madrid" })
    .format(date)
    .replace(/\.$/, "");
  const clock = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(date);
  return { hour, day, clock };
}

function line(points: string) {
  return points;
}

export function PeakChart({ points }: { points: PeakPoint[] }) {
  const clipId = useId().replaceAll(":", "");
  const [hover, setHover] = useState<number | null>(null);
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const n = Math.max(points.length, 1);
  const yMax = Math.max(1, ...points.map((p) => p.total));
  const x = (i: number) => PAD.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.t + innerH - (v / yMax) * innerH;

  const paths = useMemo(() => {
    return SERIES.map((series) => {
      if (!points.length) return { ...series, area: "", stroke: "" };
      const coords = points.map((p, i) => `${x(i).toFixed(1)},${y(p[series.key]).toFixed(1)}`);
      const stroke = `M ${coords.join(" L ")}`;
      const area = `${stroke} L ${x(points.length - 1).toFixed(1)},${(PAD.t + innerH).toFixed(1)} L ${x(0).toFixed(1)},${(PAD.t + innerH).toFixed(1)} Z`;
      return { ...series, area, stroke };
    });
  }, [points, n, yMax]);

  const ticksY = [0, Math.round(yMax / 2), yMax];
  const ticksX = points.flatMap((p, i) => {
    const { hour, day } = madridParts(p.at);
    return hour === 8 || (i === 0 && hour < 8) ? [{ i, label: day }] : [];
  });
  const active = hover != null ? points[hover] : null;

  return (
    <div className={styles.wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label="Llamadas por hora">
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        {ticksY.map((tick) => (
          <g key={tick}>
            <line className={styles.grid} x1={PAD.l} x2={W - PAD.r} y1={y(tick)} y2={y(tick)} />
            <text className={styles.axis} x={PAD.l - 8} y={y(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        {ticksX.map((tick) => (
          <text key={tick.i} className={styles.axis} x={x(tick.i)} y={H - 10} textAnchor="middle">{tick.label}</text>
        ))}
        <g clipPath={`url(#${clipId})`}>
          {paths.map((series) => (
            <g key={series.key}>
              <path d={series.area} fill={series.fill} fillOpacity={series.fillOpacity} />
              <path d={line(series.stroke)} fill="none" stroke={series.stroke} strokeWidth="1.6" />
            </g>
          ))}
        </g>
        {active && hover != null ? (
          <line className={styles.cursor} x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + innerH} />
        ) : null}
        <rect
          x={PAD.l}
          y={PAD.t}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - box.left) / box.width;
            setHover(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))));
          }}
        />
      </svg>
      <div className={styles.legend}>
        {SERIES.map((series) => (
          <span key={series.key}>
            <i style={{ background: series.stroke }} />
            {series.label}
          </span>
        ))}
        {active ? (
          <strong>
            {madridParts(active.at).day} {madridParts(active.at).clock}
            {" · "}
            {active.total} llamadas
            {active.escalado ? ` · ${active.escalado} escaladas` : ""}
            {active.abierto ? ` · ${active.abierto} sin cierre` : ""}
          </strong>
        ) : null}
      </div>
    </div>
  );
}
