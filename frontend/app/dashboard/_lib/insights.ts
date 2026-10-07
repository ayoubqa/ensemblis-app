// Shared, page-local helpers for the signed-in workspace (dashboard, billing,
// workflows, workforce). Pure functions over real API data.
import type { Task, Transaction } from "@/lib/api";
import { shortDate } from "@/lib/format";

export const isActive = (t: Pick<Task, "status">) => t.status === "RUNNING" || t.status === "PLANNING";

/** 0–100 progress from completed steps / total steps. */
export function taskProgress(t: Task): number {
  if (t.status === "COMPLETED") return 100;
  const total = t.steps.length;
  if (!total) return t.status === "PLANNING" ? 4 : 8;
  const done = t.steps.filter((s) => s.status === "COMPLETED").length;
  const running = t.steps.some((s) => s.status === "RUNNING") ? 0.5 : 0;
  return Math.max(4, Math.min(99, Math.round(((done + running) / total) * 100)));
}

/** The step currently being worked on (or the next queued one). */
export function currentStep(t: Task) {
  return t.steps.find((s) => s.status === "RUNNING") ?? t.steps.find((s) => s.status === "QUEUED") ?? null;
}

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Net spend in cents a transaction represents (charges positive, refunds negative, top-ups 0). */
export function netSpend(tx: Transaction): number {
  if (tx.type === "TASK_CHARGE") return -tx.amountCents;
  if (tx.type === "REFUND") return -tx.amountCents;
  return 0;
}

/**
 * Bucket net spend into the last `n` days or weeks (oldest first).
 * Returns cents per bucket plus readable labels.
 */
export function spendSeries(txs: Transaction[], mode: "day" | "week", n: number, now = new Date()) {
  const today = startOfDay(now);
  const span = mode === "day" ? 1 : 7;
  // Weeks start on Monday.
  const anchor = mode === "day" ? today : new Date(today.getTime() - ((today.getDay() + 6) % 7) * 86400000);
  const starts: Date[] = [];
  for (let i = n - 1; i >= 0; i--) starts.push(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - i * span));
  const values = starts.map(() => 0);
  for (const tx of txs) {
    const t = new Date(tx.createdAt).getTime();
    for (let i = starts.length - 1; i >= 0; i--) {
      if (t >= starts[i].getTime()) {
        const end = new Date(starts[i].getFullYear(), starts[i].getMonth(), starts[i].getDate() + span).getTime();
        if (t < end) values[i] += netSpend(tx);
        break;
      }
    }
  }
  const labels = starts.map((d) => (mode === "day" ? shortDate(d, now) : `Wk of ${shortDate(d, now)}`));
  return { values: values.map((v) => Math.max(0, v)), labels };
}

/** "Today", "Tomorrow", "in 3 days", "Oct 28" for future dates; "Overdue" if past. */
export function untilLabel(iso: string | null, now = new Date()): string {
  if (!iso) return "Not scheduled";
  const t = new Date(iso);
  const days = Math.round((startOfDay(t).getTime() - startOfDay(now).getTime()) / 86400000);
  if (days < 0) return "Due now";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `in ${days} days`;
  return shortDate(t, now);
}

/** One CSV cell, quoted when needed and safe to open in a spreadsheet. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Formula injection: a cell such as =HYPERLINK(…) (a teammate's name, a task
  // title) would run when the file is opened in Excel/Sheets. Plain numbers like "-2.00" stay numbers.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download rows as a CSV file. Returns false if the browser blocked it. */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): boolean {
  try {
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** Group tasks' billed cost by a key (excludes refunded/failed). Sorted desc. */
export function spendBy(tasks: Task[], key: (t: Task) => string | null | undefined) {
  const m = new Map<string, { cents: number; count: number }>();
  for (const t of tasks) {
    if (t.status === "REFUNDED" || t.status === "FAILED") continue;
    const k = key(t) || "Other";
    const cur = m.get(k) ?? { cents: 0, count: 0 };
    cur.cents += t.costCents;
    cur.count += 1;
    m.set(k, cur);
  }
  return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.cents - a.cents);
}
