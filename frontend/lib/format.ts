// Formatting helpers. Money in the API is always integer cents (EUR).

/** Cents → "€25", "€12.50", "€2,840". Whole euros drop the decimals. */
export function eur(cents: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  const c = Math.round(Number(cents) || 0);
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = abs % 100 === 0 && !opts.decimals;
  const s = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${neg ? "−" : ""}€${s}`;
}

/** Signed money for ledgers: "+€10", "−€25". */
export function eurSigned(cents: number): string {
  if (cents === 0) return eur(0);
  return cents > 0 ? `+${eur(cents)}` : eur(cents);
}

/** Whole-euro amount (not cents) → "€25" — for marketing copy / static data. */
export function eurWhole(euros: number): string {
  return "€" + Number(euros).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** 2481 → "2,481" */
export function num(n: number | null | undefined, decimals = 0): string {
  return (Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** 96.8 → "96.8%"; null → "—" */
export function pct(n: number | null | undefined, decimals?: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const d = decimals ?? (Number.isInteger(n) ? 0 : 1);
  return `${n.toFixed(d)}%`;
}

function toDate(d: string | number | Date): Date {
  return d instanceof Date ? d : new Date(d);
}

/** "just now", "2m ago", "3h ago", "Yesterday", "4d ago", "Sep 25" */
export function relativeTime(d: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const t = toDate(d);
  const diff = Math.round((now.getTime() - t.getTime()) / 1000);
  if (Number.isNaN(diff)) return "—";
  if (diff < 0) {
    const a = -diff;
    if (a < 60) return "in a moment";
    if (a < 3600) return `in ${Math.round(a / 60)}m`;
    if (a < 86400) return `in ${Math.round(a / 3600)}h`;
    return `in ${Math.round(a / 86400)}d`;
  }
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 172800) return "Yesterday";
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)}d ago`;
  return shortDate(t, now);
}

/** "Sep 25" (current year) or "Sep 25, 2025" */
export function shortDate(d: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const t = toDate(d);
  if (Number.isNaN(t.getTime())) return "—";
  const sameYear = t.getFullYear() === now.getFullYear();
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Today", "Yesterday" or "Sep 25" — used in tables and lists. */
export function dayLabel(d: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const t = toDate(d);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(t)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return shortDate(t, now);
}

/** "September 25, 2026" */
export function longDate(d: string | number | Date | null | undefined): string {
  if (!d) return "—";
  const t = toDate(d);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** "Sep 25, 14:05" */
export function dateTime(d: string | number | Date | null | undefined): string {
  if (!d) return "—";
  const t = toDate(d);
  if (Number.isNaN(t.getTime())) return "—";
  return `${shortDate(t)}, ${t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Seconds → "8m 42s" (prototype fmtT), "42s", "1h 05m". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** Duration between two timestamps (end defaults to now) → "8m 42s". */
export function durationBetween(
  start: string | number | Date | null | undefined,
  end?: string | number | Date | null
): string {
  if (!start) return "—";
  const a = toDate(start).getTime();
  const b = end ? toDate(end).getTime() : Date.now();
  return duration((b - a) / 1000);
}

/** 8, 12 → "8–12 min" */
export function minutesRange(low: number, high: number): string {
  if (!high || low === high) return `${low} min`;
  return `${low}–${high} min`;
}

/** "Alex Morgan" → "AM"; "SEO/AIO Analyst" → "SA" (prototype av()). */
export function initials(name: string | null | undefined): string {
  return String(name || "?")
    .split(/[ /]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** plural(3, "objective") → "3 objectives" */
export function plural(n: number, word: string, pluralWord?: string): string {
  return `${num(n)} ${n === 1 ? word : pluralWord || word + "s"}`;
}

/** First name for greetings. */
export function firstName(name: string | null | undefined): string {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

/** "Good morning" / "Good afternoon" / "Good evening" */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
