// Small text utilities shared by attachments, URL fetching and prompts.

// C0 controls except \t and \n, DEL, and C1 controls. \r is normalised first.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Unpaired UTF-16 surrogates can't be stored as valid UTF-8 (Postgres rejects them).
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// Zero-width / BOM characters that only add noise.
const INVISIBLES = /[​-‍⁠﻿]/g;

/** Removes NUL/control characters and broken surrogates; normalises line endings. Keeps \n and \t. */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(LONE_SURROGATES, "�")
    .replace(INVISIBLES, "");
}

/** cleanText + tidy whitespace: trailing spaces, runs of spaces, 3+ blank lines. */
export function tidyText(s: string): string {
  return cleanText(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Collapses all whitespace (incl. newlines) to single spaces. */
export function collapse(s: string): string {
  return cleanText(s).replace(/\s+/g, " ").trim();
}

/** Cuts to at most `max` UTF-16 units without splitting a surrogate pair. */
export function truncateChars(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, Math.max(0, max));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/**
 * Truncates for a prompt, preferring a line/sentence boundary, and marks the
 * cut so the model knows the text continues.
 */
export function clip(s: string, max: number, marker = " […]"): string {
  if (s.length <= max) return s;
  const room = Math.max(0, max - marker.length);
  const cut = truncateChars(s, room);
  const breakAt = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return (breakAt > room * 0.6 ? cut.slice(0, breakAt + 1) : cut).trimEnd() + marker;
}

/** Splits `budget` characters fairly between texts of the given lengths (short ones give their spare room to long ones). */
export function fairSplit(lengths: number[], budget: number): number[] {
  const alloc = lengths.map(() => 0);
  let remaining = Math.max(0, Math.floor(budget));
  let open = lengths.map((_, i) => i).filter((i) => lengths[i] > 0);
  // Every pass hands out at least 1 char, so this always terminates.
  while (open.length && remaining > 0) {
    const share = Math.max(1, Math.floor(remaining / open.length));
    const next: number[] = [];
    for (const i of open) {
      if (remaining <= 0) break;
      const give = Math.min(lengths[i] - alloc[i], share, remaining);
      alloc[i] += give;
      remaining -= give;
      if (alloc[i] < lengths[i]) next.push(i);
    }
    open = next;
  }
  return alloc;
}

/** Hostname without "www.", or null for an invalid URL. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Normalised URL for de-duplication: lower-case host without www, no hash, no tracking params, no trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$)/i.test(key)) u.searchParams.delete(key);
    }
    let s = `${u.protocol === "http:" ? "https:" : u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    s = s.replace(/\?$/, "");
    return s;
  } catch {
    return url.trim().toLowerCase();
  }
}
