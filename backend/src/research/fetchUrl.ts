// Safe server-side fetching of a client-supplied web page (link attachments).
//
// Defences against SSRF (making the server reach internal services):
//   - only http/https on the default ports, no credentials in the URL, no
//     single-label/intranet host names;
//   - IP-literal hosts must be public (checked on every hop, because Node
//     never runs a DNS lookup for an IP literal);
//   - host names are resolved by `guardedLookup` INSIDE the connection agent,
//     so the address that is actually connected to is the one that was
//     checked (no DNS-rebinding window);
//   - redirects are followed manually (max 3) and every hop is re-validated;
//   - 10 s overall deadline, at most 2 MB read, HTML / plain text only.

import zlib from "node:zlib";
import { Agent, request } from "undici";
import { config } from "../config";
import { recordUsage } from "../lib/usage";
import { extractPlainText, extractReadableText } from "./extract";
import { BlockedAddressError, createGuardedLookup, isPublicAddress } from "./netGuard";
import { truncateChars } from "./text";

export interface FetchedPage {
  title: string;
  text: string;
  finalUrl: string;
}

/** A user-facing fetch problem (maps to HTTP 400). */
export class FetchUrlError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "FetchUrlError";
  }
}

export interface SafeFetcherOptions {
  /** Address policy (default: public addresses only). Tests may relax it for local stub servers. */
  isAllowed?: (ip: string) => boolean;
  /** DNS resolver used by the guarded lookup (tests). */
  resolver?: Parameters<typeof createGuardedLookup>[0];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxChars?: number;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_URL_LENGTH = 2048;

/** Validates the shape of a URL and returns it parsed, or throws FetchUrlError. */
export function validateFetchUrl(raw: string, isAllowed: (ip: string) => boolean = isPublicAddress): URL {
  const s = (raw ?? "").trim();
  if (!s) throw new FetchUrlError("Enter a web address.");
  if (s.length > MAX_URL_LENGTH) throw new FetchUrlError("That web address is too long.");
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new FetchUrlError("That doesn't look like a valid web address (it should start with https://).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchUrlError("Only http:// and https:// links can be imported.");
  }
  if (url.username || url.password) throw new FetchUrlError("Links with a username or password can't be imported.");
  // URL normalises the default port to "" — anything else is a non-standard port.
  if (url.port !== "") throw new FetchUrlError("Only links on the standard web ports (80/443) can be imported.");

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new FetchUrlError("That web address has no host name.");
  const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(":");
  if (isIpLiteral) {
    if (!isAllowed(host)) throw new FetchUrlError("That address points to a private or reserved network and can't be fetched.");
  } else {
    if (!host.includes(".") || /\.(localhost|local|internal|intranet|lan|home\.arpa|corp)$/.test(host) || host === "localhost") {
      throw new FetchUrlError("That address points to a private network name and can't be fetched.");
    }
  }
  return url;
}

function headerValue(h: string | string[] | undefined): string {
  return Array.isArray(h) ? h[0] ?? "" : h ?? "";
}

function findCause(err: unknown, depth = 0): unknown {
  if (!err || typeof err !== "object" || depth > 5) return null;
  if (err instanceof BlockedAddressError || (err as { code?: string }).code === "EBLOCKEDADDRESS") return err;
  return findCause((err as { cause?: unknown }).cause, depth + 1);
}

function errorCode(err: unknown, depth = 0): string {
  if (!err || typeof err !== "object" || depth > 5) return "";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code) return code;
  return errorCode((err as { cause?: unknown }).cause, depth + 1);
}

function friendlyNetworkError(err: unknown, host: string): FetchUrlError {
  if (err instanceof FetchUrlError) return err;
  if (findCause(err)) return new FetchUrlError("That address points to a private or reserved network and can't be fetched.");
  const name = (err as { name?: string })?.name ?? "";
  const code = errorCode(err);
  if (name === "AbortError" || name === "TimeoutError" || /TIMEOUT/i.test(code)) {
    return new FetchUrlError("That website took too long to respond. Try again, or paste the text as a file instead.");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new FetchUrlError(`We couldn't find the website "${host}". Check the address.`);
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return new FetchUrlError(`"${host}" refused the connection.`);
  if (/CERT|SSL|TLS/i.test(code)) return new FetchUrlError(`"${host}" has an invalid security certificate, so it wasn't fetched.`);
  return new FetchUrlError(`We couldn't fetch that page${code ? ` (${code})` : ""}. Try again, or paste the text as a file instead.`);
}

/** Picks a text decoder from the Content-Type charset, a BOM or a <meta charset>. */
function decodeBody(buf: Buffer, contentType: string, isHtml: boolean): string {
  let label = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1] ?? "";
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) label = "utf-8";
  else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) label = "utf-16le";
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) label = "utf-16be";
  if (!label && isHtml) {
    const head = buf.subarray(0, 2048).toString("latin1");
    label =
      /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ??
      "";
  }
  try {
    return new TextDecoder(label || "utf-8").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function decompress(buf: Buffer, encoding: string, maxBytes: number): Buffer {
  const enc = encoding.trim().toLowerCase();
  if (!enc || enc === "identity") return buf;
  try {
    if (enc === "gzip" || enc === "x-gzip") return zlib.gunzipSync(buf, { maxOutputLength: maxBytes });
    if (enc === "deflate") return zlib.inflateSync(buf, { maxOutputLength: maxBytes });
    if (enc === "br") return zlib.brotliDecompressSync(buf, { maxOutputLength: maxBytes });
  } catch {
    throw new FetchUrlError("That page is too large or couldn't be decompressed. Paste the text as a file instead.");
  }
  throw new FetchUrlError("That page uses an unsupported compression format.");
}

/** Builds a fetcher with a given address policy. `fetchUrl` below is the strict production one. */
export function createSafeFetcher(opts: SafeFetcherOptions = {}) {
  const isAllowed = opts.isAllowed ?? isPublicAddress;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const lookup = createGuardedLookup(opts.resolver, isAllowed);
  const agent = new Agent({
    connect: { lookup: lookup as never, timeout: timeoutMs },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    keepAliveTimeout: 4_000,
    connections: 8,
  });
  const userAgent = `Ensemblis/1.0 (+${config.appUrl})`;

  return async function safeFetch(rawUrl: string): Promise<FetchedPage> {
    const maxChars = opts.maxChars ?? config.attachments.maxChars;
    const deadline = Date.now() + timeoutMs;
    let url = validateFetchUrl(rawUrl, isAllowed);

    for (let hop = 0; ; hop++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new FetchUrlError("That website took too long to respond. Try again, or paste the text as a file instead.");

      let res: Awaited<ReturnType<typeof request>>;
      try {
        res = await request(url, {
          method: "GET",
          dispatcher: agent,
          maxRedirections: 0,
          signal: AbortSignal.timeout(remaining),
          headersTimeout: remaining,
          bodyTimeout: remaining,
          headers: {
            "user-agent": userAgent,
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
            "accept-encoding": "identity",
            "accept-language": "en;q=1, *;q=0.5",
          },
        });
      } catch (err) {
        throw friendlyNetworkError(err, url.hostname);
      }

      if (REDIRECTS.has(res.statusCode)) {
        await res.body.dump().catch(() => undefined);
        const location = headerValue(res.headers.location);
        if (!location) throw new FetchUrlError("That link redirects without saying where to.");
        if (hop >= maxRedirects) throw new FetchUrlError("That link redirects too many times.");
        let next: string;
        try {
          next = new URL(location, url).toString();
        } catch {
          throw new FetchUrlError("That link redirects to an invalid address.");
        }
        url = validateFetchUrl(next, isAllowed);
        continue;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        await res.body.dump().catch(() => undefined);
        const hint =
          res.statusCode === 401 || res.statusCode === 403
            ? " The page may require a login or block automated access — paste the text as a file instead."
            : res.statusCode === 404
              ? " Check the address."
              : "";
        throw new FetchUrlError(`That page returned an error (HTTP ${res.statusCode}).${hint}`);
      }

      const contentType = headerValue(res.headers["content-type"]).toLowerCase();
      const mime = contentType.split(";")[0].trim();
      if (mime === "application/pdf") {
        await res.body.dump().catch(() => undefined);
        throw new FetchUrlError("This link is a PDF. Upload the PDF as a file instead.");
      }
      const known = mime === "text/html" || mime === "application/xhtml+xml" || mime === "text/plain";
      if (mime && !known) {
        await res.body.dump().catch(() => undefined);
        throw new FetchUrlError(
          `This link isn't a web page (it's "${mime.slice(0, 60)}"). Only HTML pages and plain-text files can be imported — upload documents as files instead.`
        );
      }

      // Read at most maxBytes; a longer page is cut off (we only need its text).
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of res.body) {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          const room = maxBytes - total;
          if (b.length >= room) {
            chunks.push(b.subarray(0, room));
            total += room;
            break;
          }
          chunks.push(b);
          total += b.length;
        }
      } catch (err) {
        throw friendlyNetworkError(err, url.hostname);
      } finally {
        if (total >= maxBytes) res.body.destroy();
      }
      let buf: Buffer = Buffer.concat(chunks);
      buf = decompress(buf, headerValue(res.headers["content-encoding"]), maxBytes);

      // No Content-Type: accept only what looks like text.
      let isHtml = mime === "text/html" || mime === "application/xhtml+xml";
      if (!mime) {
        if (buf.subarray(0, 4096).includes(0)) {
          throw new FetchUrlError("That link doesn't look like a web page. Upload documents as files instead.");
        }
        isHtml = /^\s*</.test(buf.subarray(0, 512).toString("latin1"));
      }

      const body = decodeBody(buf, contentType, isHtml);
      const page = isHtml ? extractReadableText(body) : extractPlainText(body);
      const finalUrl = url.toString();
      return {
        title: page.title || url.hostname.replace(/^www\./, ""),
        text: truncateChars(page.text, maxChars).trim(),
        finalUrl,
      };
    }
  };
}

let strictFetcher: ReturnType<typeof createSafeFetcher> | null = null;

/**
 * Fetches a public web page and returns its readable text (truncated to
 * config.attachments.maxChars). Throws FetchUrlError with a user-facing message.
 */
export async function fetchUrl(rawUrl: string): Promise<FetchedPage> {
  if (!strictFetcher) strictFetcher = createSafeFetcher();
  try {
    const page = await strictFetcher(rawUrl);
    void recordUsage({ kind: "fetch", provider: "web", ok: true }).catch(() => undefined);
    return page;
  } catch (err) {
    void recordUsage({ kind: "fetch", provider: "web", ok: false }).catch(() => undefined);
    throw err;
  }
}
