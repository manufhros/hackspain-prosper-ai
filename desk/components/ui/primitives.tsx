import Link from "next/link";
import { ChevronRight, Info, Inbox, type LucideIcon } from "lucide-react";
import type { IconName } from "@/lib/nav";
import { ICONS } from "./icons";
import s from "./ui.module.css";

/* ---------------------------------------------------------------------------
   Tones and badges
--------------------------------------------------------------------------- */
export type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

export function Badge({
  tone = "neutral",
  dot = false,
  children,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className={s.badge} data-tone={tone} title={title}>
      {dot ? <i aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export const OUTCOME_META: Record<string, { label: string; tone: Tone }> = {
  cita: { label: "Cita reservada", tone: "success" },
  alta: { label: "Alta de paciente", tone: "info" },
  escalado: { label: "Escalado", tone: "danger" },
  sin_cita: { label: "Sin cita", tone: "warning" },
  cancelacion: { label: "Cita anulada", tone: "neutral" },
  cambio: { label: "Cita modificada", tone: "info" },
  en_curso: { label: "En curso", tone: "info" },
  submitted: { label: "Acción sin clasificar", tone: "neutral" },
  sin_cierre: { label: "Sin cierre", tone: "neutral" },
};

export function outcomeMeta(outcome: string) {
  return OUTCOME_META[outcome] ?? { label: outcome, tone: "neutral" as Tone };
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const meta = outcomeMeta(outcome);
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

/* ---------------------------------------------------------------------------
   Buttons
--------------------------------------------------------------------------- */
type ButtonBase = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  icon?: LucideIcon;
  children?: React.ReactNode;
  className?: string;
};

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonBase & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button
      type="button"
      className={[s.btn, className].filter(Boolean).join(" ")}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {Icon ? <Icon size={16} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon: Icon,
  children,
  className,
  current,
}: ButtonBase & { href: string; current?: boolean }) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={[s.btn, className].filter(Boolean).join(" ")} data-variant={variant} data-size={size}>
      {Icon ? <Icon size={16} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------------------
   Page header
--------------------------------------------------------------------------- */
export type Crumb = { label: string; href?: string };

export function PageHeader({
  crumbs,
  eyebrow,
  title,
  description,
  actions,
}: {
  crumbs?: Crumb[];
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className={s.pageHeader}>
      {crumbs?.length ? (
        <nav className={s.crumbs} aria-label="Ruta">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <span key={`${crumb.label}-${index}`} className={s.crumbs}>
                {last ? (
                  <strong>{crumb.label}</strong>
                ) : crumb.href ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
                {last ? null : <ChevronRight size={13} aria-hidden="true" />}
              </span>
            );
          })}
        </nav>
      ) : null}
      <div className={s.headRow}>
        <div className={s.headText}>
          {eyebrow ? <p className={s.eyebrow}>{eyebrow}</p> : null}
          <h1 className={s.title}>{title}</h1>
          {description ? <p className={s.description}>{description}</p> : null}
        </div>
        {actions ? <div className={s.headActions}>{actions}</div> : null}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------------------
   Cards
--------------------------------------------------------------------------- */
export function Card({
  title,
  description,
  actions,
  footer,
  flush = false,
  children,
  className,
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  /** Remove body padding (tables, lists that draw their own rows). */
  flush?: boolean;
  children?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={[s.card, className].filter(Boolean).join(" ")} data-flush={flush} id={id}>
      {title || actions ? (
        <header className={s.cardHead}>
          <div className={s.cardTitle}>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className={s.cardActions}>{actions}</div> : null}
        </header>
      ) : null}
      {children !== undefined ? <div className={s.cardBody}>{children}</div> : null}
      {footer ? <footer className={s.cardFoot}>{footer}</footer> : null}
    </section>
  );
}

/* ---------------------------------------------------------------------------
   Stat cards
--------------------------------------------------------------------------- */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className={s.statGrid}>{children}</div>;
}

export function StatCard({
  label,
  value,
  icon,
  delta,
  hint,
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  icon?: IconName | LucideIcon;
  delta?: { label: string; tone?: Tone };
  hint?: React.ReactNode;
  emphasis?: boolean;
}) {
  const Icon = typeof icon === "string" ? ICONS[icon] : icon;
  const long = typeof value === "string" && value.length > 8;
  return (
    <article className={s.stat} data-emphasis={emphasis}>
      <div className={s.statHead}>
        <p className={s.statLabel}>{label}</p>
        {Icon ? <Icon size={16} strokeWidth={1.9} aria-hidden="true" /> : null}
      </div>
      <p className={s.statValue} data-long={long}>
        {value}
      </p>
      {delta || hint ? (
        <div className={s.statFoot}>
          {delta ? <Badge tone={delta.tone ?? "brand"}>{delta.label}</Badge> : null}
          {hint ? <span>{hint}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

/* ---------------------------------------------------------------------------
   Bar list
--------------------------------------------------------------------------- */
export type BarRow = {
  label: string;
  value: number;
  /** Formatted value; defaults to the raw number. */
  display?: string;
  /** Right-most secondary figure, usually a share (e.g. "26 %"). */
  pct?: string;
  color?: string;
};

export function BarList({ rows, max }: { rows: BarRow[]; max?: number }) {
  const top = max ?? Math.max(...rows.map((row) => row.value), 1);
  const compact = rows.every((row) => row.pct == null);
  return (
    <ol className={s.bars}>
      {rows.map((row) => (
        <li key={row.label} data-compact={compact}>
          <span className={s.barLabel} title={row.label}>
            {row.label}
          </span>
          <span className={s.barTrack} aria-hidden="true">
            <i style={{ width: `${Math.max(2, Math.round((row.value / top) * 100))}%`, background: row.color }} />
          </span>
          <span className={s.barValue}>{row.display ?? row.value}</span>
          {compact ? null : <span className={s.barPct}>{row.pct}</span>}
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------------------
   Misc
--------------------------------------------------------------------------- */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className={s.empty} role="status">
      <Icon size={26} strokeWidth={1.6} aria-hidden="true" />
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className={s.note}>
      <Info size={15} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function Entity({
  name,
  meta,
  initials,
  tint,
  anon = false,
  square = false,
}: {
  name: string;
  meta?: React.ReactNode;
  initials?: string;
  tint?: string;
  anon?: boolean;
  square?: boolean;
}) {
  const text =
    initials ??
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  return (
    <span className={s.entity}>
      <span
        className={s.entityMark}
        data-anon={anon}
        data-shape={square ? "square" : undefined}
        style={tint ? { background: tint } : undefined}
        aria-hidden="true"
      >
        {anon ? "?" : text}
      </span>
      <span className={s.entityText}>
        <strong data-anon={anon} title={name}>
          {name}
        </strong>
        {meta ? <small>{meta}</small> : null}
      </span>
    </span>
  );
}

export function KeyValues({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className={s.kv}>
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Grid2({ even = false, children }: { even?: boolean; children: React.ReactNode }) {
  return (
    <div className={s.grid2} data-even={even}>
      {children}
    </div>
  );
}

export function Stack({ children }: { children: React.ReactNode }) {
  return <div className={s.stack}>{children}</div>;
}
