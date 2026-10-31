// TEMPORARY operator diagnostic (GET /api/auth/operator-check): why the signed-in account is or isn't an operator.
// Remove once production operator access is confirmed.
//
// It answers only for the caller's own address. ADMIN_EMAILS is never listed: no entry, masked form or count is
// returned. The check looks for the one entry that resembles the caller's address — the same address once quotes,
// invisible characters, a pasted "ADMIN_EMAILS="/"mailto:" prefix, angle brackets or a wrong separator are set
// aside, or written with look-alike letters — and reports what is wrong with THAT entry. Anything else in the
// list is never described. The resemblance is only used to find the caller's entry for this report: the live rule
// (config.adminEmails, isAdminEmail) stays an exact match.

import { parseAdminEmails } from "../config";

/** Format/invisible characters a copy-paste can carry (zero-width space/joiners, bidi marks, word joiner, BOM, soft hyphen…). */
const INVISIBLE_CHARS = "\\u00ad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff";
const INVISIBLE = new RegExp(`[${INVISIBLE_CHARS}]`);
const INVISIBLE_ALL = new RegExp(`[${INVISIBLE_CHARS}]`, "g");
const QUOTE_CHARS = "\"'\\u2018\\u2019\\u201c\\u201d`";
const QUOTES = new RegExp(`[${QUOTE_CHARS}]`);
const QUOTES_ALL = new RegExp(`[${QUOTE_CHARS}]`, "g");
const PASTED_PREFIX = /^(admin[\s_-]*emails?\s*=|mailto:)\s*/i;
const ANGLE_BRACKETS = /^<\s*(.*?)\s*>$/;

/**
 * Peels formatting off an entry in any order and nesting ("<mailto:…>", "ADMIN_EMAILS=<…>", "mailto: …"),
 * trimming after each step. Formatting only: it never touches the address's own characters, so formatting alone
 * can never read as look-alike letters.
 */
function unwrap(s: string): { bare: string; prefix: boolean; brackets: boolean } {
  let bare = s.trim();
  let prefix = false;
  let brackets = false;
  for (let changed = true; changed; ) {
    changed = false;
    const unprefixed = bare.replace(PASTED_PREFIX, "").trim();
    if (unprefixed !== bare) [bare, prefix, changed] = [unprefixed, true, true];
    const inside = ANGLE_BRACKETS.exec(bare);
    if (inside) [bare, brackets, changed] = [inside[1].trim(), true, true];
  }
  return { bare, prefix, brackets };
}

/** Latin look-alikes (Cyrillic, Greek) — only to recognise the caller's entry, never to authorise. */
const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i",
  "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ӏ": "l", "ԛ": "q", "ԝ": "w",
  "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ρ": "p", "τ": "t",
  "υ": "u", "χ": "x", "ℓ": "l",
};
const skeleton = (s: string) => [...s.normalize("NFKC").toLowerCase()].map((c) => CONFUSABLES[c] ?? c).join("");
const clean = (s: string) => s.replace(INVISIBLE_ALL, "").replace(QUOTES_ALL, "").trim();

const codePoint = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

export type EntryIssue = "quotes" | "invisible_characters" | "look_alike_characters" | "pasted_prefix" | "angle_brackets" | "wrong_separator";

export interface YourEntry {
  /** Empty when the entry is exactly your address. */
  issues: EntryIssue[];
  /** Code points of the invisible or non-ASCII characters in YOUR entry (e.g. "U+200B", "U+0430"). */
  unusualCharacters: string[];
}

export interface OperatorCheck {
  adminEmailsDefined: boolean;
  hasEntries: boolean;
  /** The live rule (config.adminEmails, as loaded at boot) for the caller's own address. */
  yourEmailMatches: boolean;
  /** The entry that resembles your address, and what is wrong with it; null when none does. */
  yourEntry: YourEntry | null;
  /** No entry resembles your address, but one is within two typing edits of it (a typo). */
  closeMatch: boolean;
  /** process.env.ADMIN_EMAILS now differs from what was loaded at boot. */
  differsFromBootValue: boolean;
  /** Names (never values) of variables that are a misspelling of ADMIN_EMAILS — case, spaces, "_"/"-", singular. */
  nearMissKeys: string[];
}

/** ADMIN_EMAIL, admin_emails, "ADMIN_EMAILS ", ADMIN-EMAILS…: a key that was meant to be ADMIN_EMAILS. */
const NEAR_MISS_KEY = /^\s*admin[\s_-]*emails?\s*$/i;

/** Your entry among the parsed ones, with what's wrong with it — or null. Never describes another entry. */
export function findYourEntry(entries: string[], yourEmail: string): YourEntry | null {
  const mine = skeleton(yourEmail.trim());
  for (const entry of entries) {
    // A ";" or space instead of "," leaves several addresses in one entry: look inside it too.
    const parts = [entry, ...entry.split(/[;\s]+/).filter((p) => p && p !== entry)];
    for (const part of parts) {
      const { bare, prefix, brackets } = unwrap(clean(part));
      if (skeleton(bare) !== mine) continue;
      const unusual = [...new Set([...part].filter((ch) => INVISIBLE.test(ch) || ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x20).map(codePoint))];
      const issues: EntryIssue[] = [];
      if (QUOTES.test(part)) issues.push("quotes");
      if (INVISIBLE.test(part)) issues.push("invisible_characters");
      // Only the address itself, after all formatting is peeled off, can carry look-alike letters.
      if (bare.toLowerCase() !== yourEmail.trim().toLowerCase()) issues.push("look_alike_characters");
      if (prefix) issues.push("pasted_prefix");
      if (brackets) issues.push("angle_brackets");
      if (part !== entry) issues.push("wrong_separator");
      return { issues, unusualCharacters: unusual };
    }
  }
  return null;
}

/** Levenshtein distance, stopping once it exceeds `max`. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...cur) > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * @param raw        process.env.ADMIN_EMAILS now
 * @param bootList   config.adminEmails (what the running process authorises with)
 * @param yourEmail  the signed-in account's stored address — the only address ever compared
 * @param envKeys    Object.keys(process.env) — names only, filtered to ADMIN_EMAILS misspellings
 */
export function operatorCheck(raw: string | undefined, bootList: string[], yourEmail: string, envKeys: string[]): OperatorCheck {
  const entries = parseAdminEmails(raw);
  const mine = yourEmail.trim().toLowerCase();
  const yourEntry = findYourEntry(entries, mine);
  return {
    adminEmailsDefined: raw !== undefined,
    hasEntries: entries.length > 0,
    yourEmailMatches: bootList.includes(mine),
    yourEntry,
    closeMatch: !yourEntry && entries.some((e) => withinEdits(skeleton(clean(e)), skeleton(mine), 2)),
    differsFromBootValue: entries.join(",") !== bootList.join(","),
    nearMissKeys: envKeys.filter((k) => k !== "ADMIN_EMAILS" && NEAR_MISS_KEY.test(k)).map((k) => JSON.stringify(k)).sort(),
  };
}
