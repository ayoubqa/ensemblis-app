// TEMPORARY operator diagnostic (GET /api/auth/operator-check): why the signed-in account is or isn't an operator.
// Remove once production operator access is confirmed.
//
// Reports only facts about the caller's own account and the SHAPE of ADMIN_EMAILS — never the raw value, never
// another environment variable's value, never another user's data. Entries are masked ("a***n@g***s.com") and
// described by flags (quotes, invisible or non-ASCII characters) so a mistyped or pasted value can be found
// without printing it.

import { parseAdminEmails } from "../config";

/** Format/invisible characters a copy-paste can carry (zero-width space/joiners, word joiner, BOM, soft hyphen…). */
const INVISIBLE_CHARS = "\\u00ad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff";
const INVISIBLE = new RegExp(`[${INVISIBLE_CHARS}]`);
const INVISIBLE_ALL = new RegExp(`[${INVISIBLE_CHARS}]`, "g");
const QUOTES = /["'‘’“”`]/;
/** A plain ASCII address: what the sign-up form stores. */
const PLAIN_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const maskPart = (s: string) => (s.length <= 2 ? "*".repeat(s.length) : `${s[0]}***${s[s.length - 1]}`);

/** "admin@getensemblis.com" → "a***n@g***s.com": enough to recognise your own entry, not to read anyone's. */
export function maskEmail(entry: string): string {
  const at = entry.lastIndexOf("@");
  if (at < 0) return maskPart(entry);
  const [first, ...rest] = entry.slice(at + 1).split(".");
  return `${maskPart(entry.slice(0, at))}@${[maskPart(first), ...rest].join(".")}`;
}

const codePoint = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

export interface EntryReport {
  masked: string;
  length: number;
  looksLikeEmail: boolean;
  hasQuotes: boolean;
  /** Code points of invisible or non-ASCII characters (e.g. "U+200B", "U+0430"), never the characters' context. */
  unusualCharacters: string[];
}

export interface OperatorCheck {
  adminEmailsDefined: boolean;
  entryCount: number;
  entries: EntryReport[];
  /** The live rule (config.adminEmails, as loaded at boot) for the caller's own address. */
  yourEmailMatches: boolean;
  /** Would match if quotes and invisible characters were removed: points at a pasted value. */
  yourEmailMatchesAfterCleanup: boolean;
  /** process.env.ADMIN_EMAILS now differs from what was loaded at boot. */
  differsFromBootValue: boolean;
  /** Environment variable NAMES (never values) that mention ADMIN, other than ADMIN_EMAILS itself: a misspelt key. */
  similarKeys: string[];
}

export function describeEntry(entry: string): EntryReport {
  const unusual = [...new Set([...entry].filter((ch) => INVISIBLE.test(ch) || ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x20).map(codePoint))];
  return { masked: maskEmail(entry), length: [...entry].length, looksLikeEmail: PLAIN_EMAIL.test(entry), hasQuotes: QUOTES.test(entry), unusualCharacters: unusual };
}

const cleanup = (s: string) => s.replace(INVISIBLE_ALL, "").replace(/["'‘’“”`]/g, "").trim().toLowerCase();

/**
 * @param raw        process.env.ADMIN_EMAILS now
 * @param bootList   config.adminEmails (what the running process authorises with)
 * @param yourEmail  the signed-in account's stored address
 * @param envKeys    Object.keys(process.env) — names only
 */
export function operatorCheck(raw: string | undefined, bootList: string[], yourEmail: string, envKeys: string[]): OperatorCheck {
  const entries = parseAdminEmails(raw);
  const mine = yourEmail.trim().toLowerCase();
  return {
    adminEmailsDefined: raw !== undefined,
    entryCount: entries.length,
    entries: entries.map(describeEntry),
    yourEmailMatches: bootList.includes(mine),
    yourEmailMatchesAfterCleanup: entries.map(cleanup).includes(mine),
    differsFromBootValue: entries.join(",") !== bootList.join(","),
    similarKeys: envKeys.filter((k) => k !== "ADMIN_EMAILS" && /admin/i.test(k)).map((k) => JSON.stringify(k)).sort(),
  };
}
