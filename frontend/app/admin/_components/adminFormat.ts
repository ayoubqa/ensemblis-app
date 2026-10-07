import type { DayCount } from "@/lib/api";

/** "2026-10-04" (UTC day) → "Today" / "Oct 4". */
export function dayLabelUTC(day: string, now = new Date()): string {
  if (day === now.toISOString().slice(0, 10)) return "Today";
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** 1234567 → "1.2M", 34100 → "34.1K". */
export function compact(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1000) return v.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export const sumDays = (xs: DayCount[] | null | undefined) => (xs ?? []).reduce((n, d) => n + (Number(d.count) || 0), 0);

/** Usage vs a limit → tone. 0/negative limit = "no limit". */
export function usageTone(used: number, limit: number): "ok" | "warn" | "bad" {
  if (!limit || limit <= 0) return "ok";
  const r = used / limit;
  if (r >= 1) return "bad";
  if (r >= 0.8) return "warn";
  return "ok";
}
