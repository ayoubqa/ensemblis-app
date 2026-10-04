import { useEffect, useState } from "react";
import type { Task, TaskStep } from "@/lib/api";
import { PLATFORM_FEE_PERCENT } from "@/lib/data";

export const isLive = (t: Pick<Task, "status"> | null) => !!t && (t.status === "RUNNING" || t.status === "PLANNING");

const ts = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

/** Seconds a step took (or has been running, against `now`). */
export function stepSeconds(s: TaskStep, now = Date.now()): number | null {
  const a = ts(s.startedAt);
  if (Number.isNaN(a)) return null;
  const b = s.completedAt ? ts(s.completedAt) : now;
  return Math.max(0, (b - a) / 1000);
}

export function sortedSteps(t: Task): TaskStep[] {
  return [...t.steps].sort((a, b) => a.order - b.order);
}

/** Ticks every `ms` while enabled — drives elapsed timers. */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return now;
}

const ROLE_WEIGHT: Record<string, number> = { Research: 0.3, Analysis: 0.45, Verification: 0.25, Report: 0.25 };

/** Illustrative cost split: platform fee, then the rest by step role weight. */
export function costByStep(t: Task): { fee: number; steps: { step: TaskStep; cents: number }[] } {
  const steps = sortedSteps(t);
  const fee = Math.round((t.costCents * PLATFORM_FEE_PERCENT) / 100);
  const pool = t.costCents - fee;
  const w = steps.map((s) => ROLE_WEIGHT[s.role] ?? 0.3);
  const total = w.reduce((x, y) => x + y, 0) || 1;
  let left = pool;
  const out = steps.map((step, i) => {
    const cents = i === steps.length - 1 ? left : Math.round((pool * w[i]) / total);
    left -= cents;
    return { step, cents };
  });
  return { fee, steps: out };
}

/** First heading (or first line) of a markdown output, as a short plain snippet. */
export function snippet(md: string | null, max = 72): string | null {
  if (!md) return null;
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  const pick = lines.find((l) => /^#{1,4}\s+/.test(l)) ?? lines[0];
  if (!pick) return null;
  const text = plain(pick.replace(/^#{1,6}\s+/, ""));
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** Strip inline markdown: **b**, _i_, `code`, [text](url). */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function words(md: string | null): number {
  if (!md) return 0;
  return md.replace(/[#*_`>|-]/g, " ").split(/\s+/).filter(Boolean).length;
}

export function clock(iso: string | number): string {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}
