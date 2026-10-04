"use client";

import Link from "next/link";
import { CSSProperties, ElementType, Fragment, ReactNode, useEffect, useRef, useState, KeyboardEvent } from "react";
import { useInView } from "@/lib/hooks";
import { prefersReducedMotion } from "@/lib/utils";
import { Icon, type IconName } from "./Icon";

// ---------------------------------------------------------------- Skeleton
/** Shimmering placeholder block (`.sk`). */
export function Skeleton({ width, height = 12, radius, className, style }: { width?: number | string; height?: number | string; radius?: number | string; className?: string; style?: CSSProperties }) {
  return <div className={className ? `sk ${className}` : "sk"} aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** Several text lines; the last one is shorter. */
export function SkeletonText({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 && lines > 1 ? "70%" : "100%"} style={{ marginTop: i ? gap : 0 }} />
      ))}
    </div>
  );
}

/** Prototype agent-card loading placeholder. */
export function SkeletonCard() {
  return (
    <div className="card" aria-hidden="true">
      <div className="row">
        <Skeleton width={40} height={40} />
        <div className="sp">
          <Skeleton height={12} width="60%" />
        </div>
      </div>
      <Skeleton height={12} style={{ marginTop: 16 }} />
      <Skeleton height={12} width="80%" style={{ marginTop: 8 }} />
    </div>
  );
}

/** Generic page skeleton (page head + card grid). Used by RequireAuth. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading">
      <div className="pagehead">
        <Skeleton height={40} width="min(420px, 80%)" radius={10} />
        <Skeleton height={14} width="min(560px, 90%)" style={{ marginTop: 14 }} />
      </div>
      <div className="grid g3">
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Progress
/** `.progress` bar (0–100). Animates width changes. */
export function ProgressBar({ value, label = "Progress", style }: { value: number; label?: string; style?: CSSProperties }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} style={style}>
      <i style={{ width: `${v}%` }} />
    </div>
  );
}

/** `.meter` (static score bar, 0–100). */
export function Meter({ value, width, label }: { value: number; width?: number | string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="meter" style={{ width }} role="meter" aria-label={label ?? "Score"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <i style={{ width: `${v}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Tabs
export type TabItem = string | { id: string; label: ReactNode; count?: number };

/** Underline tabs (`.tabs`) with roving arrow-key focus. Render panels yourself. */
export function Tabs({ tabs, value, onChange, label = "Sections", style }: { tabs: TabItem[]; value: string; onChange: (id: string) => void; label?: string; style?: CSSProperties }) {
  const items = tabs.map((t) => (typeof t === "string" ? { id: t, label: t as ReactNode, count: undefined as number | undefined } : t));
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === value);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = items.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(items[n].id);
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[n]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKey} style={style}>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          className={t.id === value ? "on" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="tag gray" style={{ marginLeft: 7, padding: "1px 7px" }}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Pill filter row (`.chip` / `.chip.on`) — single select. */
export function ChipGroup({ options, value, onChange, label = "Filter" }: { options: string[]; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="row wrapflex" style={{ gap: 8 }} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" className={o === value ? "chip on" : "chip"} aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- EmptyState
export function EmptyState({
  icon = "spark",
  title,
  children,
  action,
  card = true,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  /** A button/link node, or {label, href | onClick} for a primary button. */
  action?: ReactNode | { label: string; href?: string; onClick?: () => void; icon?: IconName };
  card?: boolean;
}) {
  let act: ReactNode = null;
  if (action && typeof action === "object" && "label" in (action as object)) {
    const a = action as { label: string; href?: string; onClick?: () => void; icon?: IconName };
    act = a.href ? (
      <Link className="btn p" href={a.href} style={{ marginTop: 12 }}>
        {a.icon && <Icon name={a.icon} />}
        {a.label}
      </Link>
    ) : (
      <button type="button" className="btn p" onClick={a.onClick} style={{ marginTop: 12 }}>
        {a.icon && <Icon name={a.icon} />}
        {a.label}
      </button>
    );
  } else act = action as ReactNode;
  return (
    <div className={card ? "card empty" : "empty"}>
      <div className="ico">
        <Icon name={icon} />
      </div>
      <b>{title}</b>
      {children && <p className="muted small">{children}</p>}
      {act}
    </div>
  );
}

// ---------------------------------------------------------------- PageHead
/** `.pagehead` — h1 + muted intro, optional eyebrow/tag above and actions on the right. */
export function PageHead({
  title,
  sub,
  eyebrow,
  tag,
  actions,
  center,
  style,
}: {
  title: ReactNode;
  sub?: ReactNode;
  eyebrow?: string;
  tag?: ReactNode;
  actions?: ReactNode;
  center?: boolean;
  style?: CSSProperties;
}) {
  const head = (
    <div style={center ? { textAlign: "center" } : undefined}>
      {eyebrow && (
        <div className="eyebrow" style={center ? { display: "flex", justifyContent: "center" } : undefined}>
          {eyebrow}
        </div>
      )}
      {tag && <div style={{ marginBottom: 12 }}>{tag}</div>}
      <h1>{title}</h1>
      {sub && <p style={center ? { marginLeft: "auto", marginRight: "auto" } : undefined}>{sub}</p>}
    </div>
  );
  if (!actions) return <div className="pagehead" style={style}>{head}</div>;
  return (
    <div className="pagehead row between wrapflex" style={{ alignItems: "flex-end", ...style }}>
      {head}
      <div className="row wrapflex">{actions}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Flow
export const FLOW_STEPS = ["Describe", "Plan", "Execute", "Verify", "Deliver"] as const;

/** Describe → Plan → Execute → Verify → Deliver indicator (prototype `flow(n)`), `step` is 0-based. */
export function Flow({ step }: { step: number }) {
  return (
    <nav className="flow" aria-label="Progress">
      {FLOW_STEPS.map((x, i) => (
        <Fragment key={x}>
          <span className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>
            {i < step && <Icon name="check" />}
            {x}
          </span>
          {i < FLOW_STEPS.length - 1 && <i aria-hidden="true" />}
        </Fragment>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- KV
/** `.kv` key/value row. */
export function KV({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="kv">
      <span>{k}</span>
      {typeof children === "string" || typeof children === "number" ? <b>{children}</b> : children}
    </div>
  );
}

/** `.stat` tile: big value + muted label (+ optional green delta). */
export function Stat({ value, label, delta, style }: { value: ReactNode; label: ReactNode; delta?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="stat" style={style}>
      <b>{value}</b>
      <span>{label}</span>
      {delta && (
        <>
          {" "}
          <em>{delta}</em>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- CountUp
/**
 * Animated number that counts up (ease-out cubic, 1s) the first time it scrolls
 * into view — prototype `.count`. Server-renders the final value (no layout
 * shift, correct without JS); respects reduced motion.
 */
export function CountUp({ to, decimals = 0, prefix = "", suffix = "", duration = 1000, className }: { to: number; decimals?: number; prefix?: string; suffix?: string; duration?: number; className?: string }) {
  const fmt = (v: number) => prefix + v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  const [ref, inView] = useInView<HTMLSpanElement>({ threshold: 0.6 });
  const [text, setText] = useState(fmt(to));
  const started = useRef(false);
  const armed = useRef(false);

  // Below the fold at mount → reset to 0 invisibly so the count-up is seen.
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight) {
      armed.current = true;
      setText(fmt(0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inView || started.current || !armed.current) {
      if (!armed.current) setText(fmt(to));
      return;
    }
    started.current = true;
    const t0 = performance.now();
    let raf = 0;
    const f = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setText(fmt(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, to]);

  return (
    <span ref={ref} className={className ? `count ${className}` : "count"}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------- Reveal
/**
 * Fades + lifts its children in when scrolled into view (`.reveal`).
 * Content already on screen at mount is shown immediately (no flash);
 * reduced-motion users always see it statically.
 */
export function Reveal({ children, as, delay = 0, className, style }: { children: ReactNode; as?: ElementType; delay?: number; className?: string; style?: CSSProperties }) {
  const Tag = (as || "div") as ElementType;
  const [ref, inView] = useInView<HTMLElement>({ threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  const [state, setState] = useState<"static" | "wait" | "shown">("static");
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    if (el.getBoundingClientRect().top > window.innerHeight) setState("wait");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (inView && state === "wait") setState("shown");
  }, [inView, state]);
  const cls = [className, state === "wait" && "rv-wait", state === "shown" && "reveal"].filter(Boolean).join(" ");
  return (
    <Tag ref={ref} className={cls || undefined} style={{ ...(delay && state === "shown" ? { animationDelay: `${delay}ms` } : null), ...style }}>
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------- Kbd
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
