// CORS_ORIGIN parsing. The value is a comma-separated list of exact browser origins ("scheme://host[:port]").
// A browser sends the origin of the page making the request; the API answers with Access-Control-Allow-Origin
// only when that string is on the list. A malformed entry (the real-world case: `https//www.example.com`, the
// colon missing) can never match anything, and without a check nothing says so: the site just cannot log in.
//
// Entries are normalised the way browsers serialise an origin (lower-case scheme and host, default port
// dropped, no path or trailing slash). Entries that cannot be a legitimate origin are ignored and reported —
// never repaired by guessing, and never widened: `www.` and the bare domain stay different origins, and a
// wildcard is refused because the API answers with credentials.
//
// No imports: config.ts loads this at start-up.

export interface CorsOriginIssue {
  /** The entry as written (cut to 200 characters). */
  entry: string;
  /** Why it is not used, or what was changed. */
  problem: string;
  /** What the entry was probably meant to be, when that is unambiguous. */
  suggestion?: string;
  /** True when the entry is still allowed (after normalising); false when it is ignored. */
  accepted: boolean;
}

export interface CorsOriginsResult {
  origins: string[];
  issues: CorsOriginIssue[];
}

const MAX_ENTRY = 200;

function stripQuotes(s: string): string {
  const m = /^(["'])(.*)\1$/.exec(s);
  return m ? m[2].trim() : s;
}

/** What a rejected entry was most likely meant to be, or undefined when it is not obvious. */
function suggest(entry: string): string | undefined {
  // https//host  /  https:/host  /  https:host  →  https://host   (a scheme that lost part of its "://")
  const broken = /^(https?)(?::\/{0,2}|\/{1,2})([^\s/].*)$/i.exec(entry);
  if (broken && (/[.:]/.test(broken[2]) || /^localhost\b/i.test(broken[2]))) {
    return `${broken[1].toLowerCase()}://${broken[2].replace(/\/+$/, "")}`;
  }
  // a bare host name
  if (/^localhost(:\d+)?$/i.test(entry)) return `http://${entry.toLowerCase()}`;
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?$/i.test(entry)) return `https://${entry.toLowerCase()}`;
  return undefined;
}

export function parseCorsOrigins(raw: string | undefined, fallback = "http://localhost:3000"): CorsOriginsResult {
  if (raw === undefined || !raw.trim()) return { origins: [fallback], issues: [] };
  const origins: string[] = [];
  const issues: CorsOriginIssue[] = [];
  const reject = (entry: string, problem: string, suggestion?: string) =>
    issues.push({ entry: entry.slice(0, MAX_ENTRY), problem, ...(suggestion ? { suggestion } : {}), accepted: false });

  for (const part of raw.split(",")) {
    const entry = stripQuotes(part.trim());
    if (!entry) continue;

    if (entry.includes("*")) {
      reject(entry, "wildcards are not allowed: the API answers with credentials, so every allowed site must be listed exactly");
      continue;
    }
    if (/\s/.test(entry)) {
      reject(entry, "contains a space — separate origins with commas, not spaces");
      continue;
    }
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      reject(entry, 'not a valid origin — it must look like "https://www.example.com" (scheme, "://", host)', suggest(entry));
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(entry, `the scheme "${url.protocol.replace(/:$/, "")}" is not http or https`, suggest(entry));
      continue;
    }
    if (!url.hostname) {
      reject(entry, "has no host name");
      continue;
    }
    if (url.username || url.password) {
      reject(entry, "an origin cannot contain a user name or password");
      continue;
    }

    const origin = url.origin; // lower-case scheme and host, default port removed
    const hadPath = url.pathname !== "/" || !!url.search || !!url.hash;
    if (!/^https?:\/\//i.test(entry)) {
      // The URL standard (and so every browser) reads `https:/host` and `https:host` as https://host.
      issues.push({ entry: entry.slice(0, MAX_ENTRY), problem: `written without "//" after the scheme; read as "${origin}"`, accepted: true });
    } else if (hadPath) {
      issues.push({ entry: entry.slice(0, MAX_ENTRY), problem: `an origin has no path; "${origin}" is used`, accepted: true });
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return { origins, issues };
}

/** Human-readable lines for the start-up log: one per ignored/adjusted entry, and one when nothing usable is left. */
export function describeCorsIssues(result: CorsOriginsResult): string[] {
  const lines = result.issues.map(
    (i) =>
      `CORS_ORIGIN entry "${i.entry}" ${i.accepted ? "was adjusted" : "is IGNORED"}: ${i.problem}.` +
      (i.suggestion ? ` Did you mean "${i.suggestion}"?` : "")
  );
  if (!result.origins.length) {
    lines.push("CORS_ORIGIN has no usable origin, so every website is blocked from calling this API (login and sign-up will fail in browsers). Set it to a comma-separated list such as https://www.example.com,https://example.com.");
  }
  return lines;
}
