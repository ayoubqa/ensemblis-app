// TEMPORARY operator diagnostic (GET /api/auth/operator-check): why the signed-in account is or isn't an operator.
// Remove once production operator access is confirmed.
//
// Reports only facts about the caller's own account and the SHAPE of ADMIN_EMAILS — never the raw value, never
// another environment variable's value, never another user's data. Entries are masked ("a***@***.com") and
// described by flags (quotes, invisible or non-ASCII characters) so a mistyped or pasted value can be found
// without printing it. The caller's address is the only one ever compared: there is no email parameter.

import { parseAdminEmails } from "../config";

/** Format/invisible characters a copy-paste can carry (zero-width space/joiners, word joiner, BOM, soft hyphen…). */
const INVISIBLE_CHARS = "\\u00ad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff";
const INVISIBLE = new RegExp(`[${INVISIBLE_CHARS}]`);
const INVISIBLE_ALL = new RegExp(`[${INVISIBLE_CHARS}]`, "g");
const QUOTES = /["'‘’“”`]/;
/** A plain ASCII address: what the sign-up form stores. */
const PLAIN_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** "admin@getensemblis.com" → "a***@***.com": the first character and the top-level domain only. */
export function maskEmail(entry: string): string {
  const at = entry.lastIndexOf("@");
  const first = entry ? [...entry][0] : "";
  if (at < 0) return `${first}***`;
  const dot = entry.lastIndexOf(".");
  return `${first}***@***${dot > at ? entry.slice(dot) : ""}`;
}

const codePoint = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

export interface EntryReport {
  masked: string;
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
  /** Names (never values) of variables that are a misspelling of ADMIN_EMAILS — case, spaces, "_"/"-", singular. */
  nearMissKeys: string[];
}

/** ADMIN_EMAIL, admin_emails, "ADMIN_EMAILS ", ADMIN-EMAILS…: a key that was meant to be ADMIN_EMAILS. */
const NEAR_MISS_KEY = /^\s*admin[\s_-]*emails?\s*$/i;

export function describeEntry(entry: string): EntryReport {
  const unusual = [...new Set([...entry].filter((ch) => INVISIBLE.test(ch) || ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x20).map(codePoint))];
  return { masked: maskEmail(entry), looksLikeEmail: PLAIN_EMAIL.test(entry), hasQuotes: QUOTES.test(entry), unusualCharacters: unusual };
}

const cleanup = (s: string) => s.replace(INVISIBLE_ALL, "").replace(/["'‘’“”`]/g, "").trim().toLowerCase();

/**
 * @param raw        process.env.ADMIN_EMAILS now
 * @param bootList   config.adminEmails (what the running process authorises with)
 * @param yourEmail  the signed-in account's stored address
 * @param envKeys    Object.keys(process.env) — names only, filtered to ADMIN_EMAILS misspellings
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
    nearMissKeys: envKeys.filter((k) => k !== "ADMIN_EMAILS" && NEAR_MISS_KEY.test(k)).map((k) => JSON.stringify(k)).sort(),
  };
}
