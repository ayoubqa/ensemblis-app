// Small framework-free utilities.

/** Join class names, skipping falsy values. cx("btn", primary && "p") */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}

/** Stable hue (0–360) from any string — for avatars without a stored hue. */
export function hueFrom(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/**
 * Fuzzy match score (higher is better, -1 = no match). Substring matches beat
 * subsequence matches; matches at word starts and earlier positions score higher.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) {
    const wordStart = idx === 0 || /[\s\-/·]/.test(t[idx - 1]);
    return 1000 - idx * 2 + (wordStart ? 200 : 0) - (t.length - q.length) * 0.5;
  }
  // subsequence
  let ti = 0;
  let score = 0;
  let last = -1;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    const gap = last < 0 ? found : found - last - 1;
    score += 10 - Math.min(gap, 9);
    if (found === 0 || /[\s\-/·]/.test(t[found - 1])) score += 6;
    last = found;
    ti = found + 1;
  }
  return score;
}

/** True when the keyboard event target is a text field (shortcuts should not fire). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(type);
  }
  return el.isContentEditable;
}

/** Safe localStorage wrappers (private mode / blocked storage never throw). */
export const storage = {
  get(key: string): string | null {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (typeof window === "undefined") return;
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
