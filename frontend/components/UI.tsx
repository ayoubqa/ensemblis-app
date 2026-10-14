"use client";

import Link from "next/link";
import { CSSProperties, ElementType, ReactNode, useEffect, useRef, useState, KeyboardEvent } from "react";
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

/** Card-shaped loading placeholder. */
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
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * Calm "nothing here yet" panel: icon tile, title, one line of explanation and
 * an optional primary action. `titleAs` makes the title a real heading when the
 * page outline needs one (default: bold text, so it never breaks the outline).
 */
export function EmptyState({
  icon = "inbox",
  title,
  children,
  action,
  card = true,
  titleAs = "b",
  className,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  /** A button/link node, or {label, href | onClick} for a primary button. */
  action?: ReactNode | { label: string; href?: string; onClick?: () => void; icon?: IconName };
  card?: boolean;
  /** "h1" when the empty state is the whole page (not found, link inactive). */
  titleAs?: "b" | "h1" | "h2" | "h3";
  className?: string;
}) {
  let act: ReactNode = null;
  if (action && typeof action === "object" && "label" in (action as object)) {
    const a = action as { label: string; href?: string; onClick?: () => void; icon?: IconName };
    act = a.href ? (
      <Link className="btn p" href={a.href}>
        {a.icon && <Icon name={a.icon} />}
        {a.label}
      </Link>
    ) : (
      <button type="button" className="btn p" onClick={a.onClick}>
        {a.icon && <Icon name={a.icon} />}
        {a.label}
      </button>
    );
  } else act = action as ReactNode;
  const T = titleAs;
  return (
    <div className={cx(card ? "card empty" : "empty", "sh-empty", className)}>
      <div className="ico" aria-hidden="true">
        <Icon name={icon} />
      </div>
      <T className="sh-empty-t">{title}</T>
      {children && <p className="muted small sh-empty-d">{children}</p>}
      {act && <div className="sh-empty-act">{act}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- PageHead
/**
 * `.pagehead` — eyebrow, the page's single <h1>, a description and an actions
 * slot on the right (wraps below on narrow screens). `description` and `sub`
 * are the same thing (`sub` kept for existing pages); `tag` sits above the h1.
 */
export function PageHead({
  title,
  sub,
  description,
  eyebrow,
  tag,
  actions,
  center,
  className,
  style,
}: {
  title: ReactNode;
  sub?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  tag?: ReactNode;
  actions?: ReactNode;
  center?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const desc = description ?? sub;
  return (
    <div className={cx("pagehead sh-ph", center && "center", className)} style={style}>
      <div className="sh-ph-main">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {tag && <div className="sh-ph-tag">{tag}</div>}
        <h1>{title}</h1>
        {desc && <p className="sh-ph-desc">{desc}</p>}
      </div>
      {actions && <div className="sh-ph-actions">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Flow
export const FLOW_STEPS = ["Objective", "Plan", "Approve", "Execute", "Verify", "Outcome"] as const;

/** Objective → Plan → Approve → Execute → Verify → Outcome stepper; `step` is 0-based (the current stage). */
export function Flow({ step, label = "Progress" }: { step: number; label?: string }) {
  return (
    <nav className="flow sh-flow" aria-label={label}>
      <ol>
        {FLOW_STEPS.map((x, i) => (
          <li key={x} className={i === step ? "on" : i < step ? "done" : undefined} aria-current={i === step ? "step" : undefined}>
            <span className="sh-flow-dot" aria-hidden="true">
              {i < step ? <Icon name="check" /> : i + 1}
            </span>
            <span className="sh-flow-lbl">
              {x}
              {i < step && <span className="sr-only"> (done)</span>}
            </span>
            {i < FLOW_STEPS.length - 1 && <i className="sh-flow-line" aria-hidden="true" />}
          </li>
        ))}
      </ol>
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

/** "⌘" on Apple devices, "Ctrl" elsewhere (decided after mount; "Ctrl" on the server). */
export function useModKey(): "⌘" | "Ctrl" {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent;
    setMac(/mac|iphone|ipad|ipod/i.test(p));
  }, []);
  return mac ? "⌘" : "Ctrl";
}
