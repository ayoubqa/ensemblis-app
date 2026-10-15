// Web research for the agents (v3). Two providers:
//
//   - Tavily (https://tavily.com) — real web search; needs TAVILY_API_KEY.
//     Free plan ≈ 1,000 searches/month, so successful calls are capped per
//     UTC day by SEARCH_DAILY_BUDGET. When today's budget is spent (or Tavily
//     fails), searches fall back to Wikipedia.
//   - Wikipedia — keyless, always available (English Wikipedia API).
//
// Never throws. Every search reports what actually happened as a
// SearchAttempt (provider, HTTP status, error, result count, duration), so
// callers can say truthfully which provider answered, which failed and why —
// a fallback is never silent. Each result carries the provider and query
// that produced it.
//
// Tavily reliability: one retry on 429/5xx when the provider asks for a wait
// of at most 5s; after a 401/403 (bad or revoked key) Tavily is skipped for
// 10 minutes instead of failing — and spending budget — on every query.

import { config } from "../config";
import { prisma } from "../db";
import { log, redact } from "../lib/log";
import { recordUsage, startOfTodayUTC } from "../lib/usage";
import { isIP } from "node:net";
import { isPublicAddress } from "./netGuard";
import { collapse } from "./text";

export type SearchKind = "web" | "wikipedia";
export type SearchProviderName = "tavily" | "wikipedia";

export interface SearchResult {
  kind: SearchKind;
  title: string;
  url: string;
  /** Extracted text the agents read (bounded). */
  content: string;
  publishedAt: string | null;
  /** The provider that returned this result. */
  provider: SearchProviderName;
  /** The query that found it. */
  query: string;
}

/** One search call (or a provider skipped for a stated reason), as it really happened. */
export interface SearchAttempt {
  query: string;
  provider: SearchProviderName;
  ok: boolean;
  /** Final HTTP status, or null when no HTTP response was received (network error, timeout, skipped). */
  httpStatus: number | null;
  /** Short, redacted reason when ok is false. */
  error: string | null;
  resultCount: number;
  ms: number;
}

// TAVILY_BASE_URL is only for pointing tests at a local stub; production uses the real API.
const TAVILY_BASE_URL = (process.env.TAVILY_BASE_URL?.trim() || "https://api.tavily.com").replace(/\/+$/, "");

/** Endpoints (mutable only so unit tests can point them at local stub servers). */
export const searchEndpoints = {
  tavily: `${TAVILY_BASE_URL}/search`,
  wikipedia: "https://en.wikipedia.org/w/api.php",
};

const TIMEOUT_MS = 15_000;
const CONTENT_CHARS = 2_000;
const ERROR_CHARS = 160;
// Wikipedia is free; this only guards against a runaway loop.
const WIKIPEDIA_DAILY_CAP = () => Math.max(1_000, config.search.dailyBudget * 10);
const TAVILY_MAX_RETRY_WAIT_MS = 5_000;
const TAVILY_DEFAULT_RETRY_WAIT_MS = 750;
const TAVILY_AUTH_COOLDOWN_MS = 10 * 60_000;

type Provider = "tavily" | "wikipedia" | "off";

// ---------------------------------------------------------------- circuit breaker

let tavilyDisabledUntil = 0;
let tavilyDisabledReason = "";

/** Why Tavily is being skipped right now, or null when it may be called. */
export function tavilyUnavailableReason(now = Date.now()): string | null {
  if (now >= tavilyDisabledUntil) return null;
  return tavilyDisabledReason || "Tavily is temporarily disabled";
}

/** Tests only: forget a tripped Tavily circuit breaker. */
export function resetSearchCircuitForTests(): void {
  tavilyDisabledUntil = 0;
  tavilyDisabledReason = "";
}

// ---------------------------------------------------------------- configuration

/** The provider actually in use (Tavily without a key quietly means Wikipedia). */
export function effectiveSearchProvider(): Provider {
  const p = config.search.provider;
  if (p === "tavily" && !config.search.tavilyApiKey) return "wikipedia";
  return p;
}

export function searchEnabled(): boolean {
  return effectiveSearchProvider() !== "off";
}

/** Human-readable effective provider, shown in the UI and owner dashboard. */
export function searchProviderLabel(): string {
  const p = effectiveSearchProvider();
  return p === "tavily" ? "Tavily web search" : p === "wikipedia" ? "Wikipedia" : "Off";
}

function userAgent(): string {
  return `Ensemblis/1.0 (+${config.appUrl})`;
}

/** Hostnames that never name a public web page (loopback, local or internal-only names). */
const NON_PUBLIC_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i;

/**
 * A search result URL is kept only when it is an http(s) URL on a public host: no embedded
 * credentials, no loopback/internal names and no IP literal outside public unicast space (e.g.
 * the cloud metadata address 169.254.169.254). Evidence URLs are shown and linked, never fetched
 * by the server, so a hostname is not resolved here.
 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!host || NON_PUBLIC_HOST.test(host)) return null;
    if (isIP(host) && !isPublicAddress(host)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Calls made today. For the Tavily budget only successful calls count, so an
 * outage or a bad key doesn't spend it; the Wikipedia runaway cap counts every call.
 */
async function searchesToday(provider: SearchProviderName): Promise<number> {
  return prisma.usageEvent.count({
    where: { kind: "search", provider, ...(provider === "tavily" ? { ok: true } : {}), createdAt: { gte: startOfTodayUTC() } },
  });
}

const clipError = (s: string) => {
  const r = redact(collapse(s));
  return r.length > ERROR_CHARS ? `${r.slice(0, ERROR_CHARS - 1)}…` : r;
};

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** A short reason from an error response body (JSON `detail.error` / `error` / `message`, or text). Never the whole body. */
function bodyReason(body: string): string {
  try {
    const j = JSON.parse(body) as { detail?: unknown; error?: unknown; message?: unknown };
    const detail = j.detail as { error?: unknown } | string | undefined;
    const m = typeof detail === "string" ? detail : typeof detail?.error === "string" ? detail.error : typeof j.error === "string" ? j.error : j.message;
    if (typeof m === "string" && m.trim()) return clipError(m);
  } catch {
    /* not JSON */
  }
  return clipError(body.slice(0, 200));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Tavily

/** Parses a Tavily /search response body into results (exported for tests). */
export function parseTavilyResponse(data: unknown, query = ""): SearchResult[] {
  const results = (data as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: SearchResult[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const url = safeHttpUrl(rec.url);
    if (!url) continue;
    const content = collapse(typeof rec.content === "string" ? rec.content : "").slice(0, CONTENT_CHARS);
    if (!content) continue;
    const title = collapse(typeof rec.title === "string" ? rec.title : "").slice(0, 200) || new URL(url).hostname;
    const published = typeof rec.published_date === "string" ? rec.published_date.trim().slice(0, 40) : "";
    out.push({ kind: "web", title, url, content, publishedAt: published || null, provider: "tavily", query });
  }
  return out;
}

type TavilyCall = { ok: true; results: SearchResult[] } | { ok: false; httpStatus: number | null; error: string; retryAfter: string | null };

async function tavilyCall(query: string, executionId: string | null): Promise<TavilyCall> {
  let outcome: TavilyCall;
  try {
    const res = await fetch(searchEndpoints.tavily, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.search.tavilyApiKey}`,
        "User-Agent": userAgent(),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ query, search_depth: "basic", max_results: 5, include_answer: false }),
    });
    if (!res.ok) {
      const reason = bodyReason(await res.text().catch(() => ""));
      outcome = { ok: false, httpStatus: res.status, error: `HTTP ${res.status}${reason ? `: ${reason}` : ""}`, retryAfter: res.headers.get("retry-after") };
    } else {
      const data = await res.json().catch(() => null);
      outcome = data ? { ok: true, results: parseTavilyResponse(data, query) } : { ok: false, httpStatus: res.status, error: "unreadable response", retryAfter: null };
    }
  } catch (err) {
    outcome = { ok: false, httpStatus: null, error: isTimeout(err) ? `timed out after ${TIMEOUT_MS / 1000}s` : clipError(errMsg(err)), retryAfter: null };
  }
  await recordUsage({ kind: "search", provider: "tavily", ok: outcome.ok, executionId, error: outcome.ok ? null : outcome.error });
  return outcome;
}

/** One Tavily search with at most one retry (429/5xx with a short wait). Results are null when it failed. */
async function tavilySearch(query: string, executionId: string | null): Promise<{ results: SearchResult[] | null; attempt: SearchAttempt }> {
  const started = Date.now();
  let call = await tavilyCall(query, executionId);
  let retried = false;
  if (!call.ok && call.httpStatus !== null && (call.httpStatus === 429 || call.httpStatus >= 500)) {
    const hinted = parseRetryAfterMs(call.retryAfter);
    const wait = hinted ?? TAVILY_DEFAULT_RETRY_WAIT_MS;
    if (wait <= TAVILY_MAX_RETRY_WAIT_MS) {
      await sleep(wait);
      retried = true;
      call = await tavilyCall(query, executionId);
    }
  }
  const ms = Date.now() - started;
  if (call.ok) {
    return { results: call.results, attempt: { query, provider: "tavily", ok: true, httpStatus: 200, error: null, resultCount: call.results.length, ms } };
  }
  if (call.httpStatus === 401 || call.httpStatus === 403) {
    // A bad or revoked key fails every query the same way: stop calling Tavily for a while.
    tavilyDisabledUntil = Date.now() + TAVILY_AUTH_COOLDOWN_MS;
    tavilyDisabledReason = `Tavily rejected the API key (HTTP ${call.httpStatus}); skipped for ${TAVILY_AUTH_COOLDOWN_MS / 60_000} min`;
  }
  const error = `${call.error}${retried ? " (after 1 retry)" : ""}`;
  log.warn("search.failed", { provider: "tavily", executionId: executionId ?? undefined, httpStatus: call.httpStatus ?? undefined, error });
  return { results: null, attempt: { query, provider: "tavily", ok: false, httpStatus: call.httpStatus, error, resultCount: 0, ms } };
}

// ---------------------------------------------------------------- Wikipedia

/** Page ids from a `list=search` response, in rank order (exported for tests). */
export function parseWikipediaSearch(data: unknown): number[] {
  const hits = (data as { query?: { search?: unknown } })?.query?.search;
  if (!Array.isArray(hits)) return [];
  const ids: number[] = [];
  for (const h of hits) {
    const id = (h as { pageid?: unknown })?.pageid;
    if (typeof id === "number" && Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Results from a `prop=extracts|info` response, ordered like `pageIds` (exported for tests). */
export function parseWikipediaPages(data: unknown, pageIds: number[], query = ""): SearchResult[] {
  const pages = (data as { query?: { pages?: unknown } })?.query?.pages;
  if (!pages || typeof pages !== "object") return [];
  const list: Record<string, unknown>[] = Array.isArray(pages)
    ? (pages as Record<string, unknown>[])
    : Object.values(pages as Record<string, Record<string, unknown>>);
  const byId = new Map<number, Record<string, unknown>>();
  for (const p of list) if (p && typeof p.pageid === "number") byId.set(p.pageid, p);
  const out: SearchResult[] = [];
  for (const id of pageIds) {
    const p = byId.get(id);
    if (!p || "missing" in p) continue;
    const title = collapse(typeof p.title === "string" ? p.title : "").slice(0, 200);
    const content = collapse(typeof p.extract === "string" ? p.extract : "").slice(0, CONTENT_CHARS);
    if (!title || !content) continue;
    const url =
      safeHttpUrl(p.fullurl) ??
      safeHttpUrl(p.canonicalurl) ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    out.push({ kind: "wikipedia", title: `${title} — Wikipedia`, url, content, publishedAt: null, provider: "wikipedia", query });
  }
  return out;
}

class WikiHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function wikiGet(params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, format: "json" }).toString();
  const res = await fetch(`${searchEndpoints.wikipedia}?${qs}`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new WikiHttpError(res.status);
  return res.json();
}

async function wikipediaSearch(query: string, executionId: string | null): Promise<{ results: SearchResult[]; attempt: SearchAttempt }> {
  const started = Date.now();
  let results: SearchResult[] = [];
  let failure: { httpStatus: number | null; error: string } | null = null;
  try {
    const ids = parseWikipediaSearch(await wikiGet({ action: "query", list: "search", srsearch: query, srlimit: "3" }));
    if (ids.length) {
      const pages = await wikiGet({
        action: "query",
        prop: "extracts|info",
        inprop: "url",
        exintro: "1",
        explaintext: "1",
        exlimit: String(ids.length),
        pageids: ids.join("|"),
      });
      results = parseWikipediaPages(pages, ids, query);
    }
  } catch (err) {
    failure =
      err instanceof WikiHttpError
        ? { httpStatus: err.status, error: `HTTP ${err.status}` }
        : { httpStatus: null, error: isTimeout(err) ? `timed out after ${TIMEOUT_MS / 1000}s` : clipError(errMsg(err)) };
    results = [];
    log.warn("search.failed", { provider: "wikipedia", executionId: executionId ?? undefined, error: failure.error });
  }
  await recordUsage({ kind: "search", provider: "wikipedia", ok: !failure, executionId, error: failure?.error ?? null });
  const ms = Date.now() - started;
  return {
    results,
    attempt: failure
      ? { query, provider: "wikipedia", ok: false, httpStatus: failure.httpStatus, error: failure.error, resultCount: 0, ms }
      : { query, provider: "wikipedia", ok: true, httpStatus: 200, error: null, resultCount: results.length, ms },
  };
}

// ---------------------------------------------------------------- public

/**
 * Which backend the next search will use: Tavily while today's budget lasts
 * and its key hasn't just been rejected, otherwise Wikipedia. Never throws.
 */
export async function activeSearchBackend(): Promise<Provider> {
  const provider = effectiveSearchProvider();
  if (provider !== "tavily") return provider;
  if (tavilyUnavailableReason()) return "wikipedia";
  try {
    return (await searchesToday("tavily")) < config.search.dailyBudget ? "tavily" : "wikipedia";
  } catch {
    return "tavily";
  }
}

const skipped = (query: string, provider: SearchProviderName, error: string): SearchAttempt => ({
  query,
  provider,
  ok: false,
  httpStatus: null,
  error,
  resultCount: 0,
  ms: 0,
});

/**
 * Searches with the configured provider: Tavily (within today's budget and
 * unless its key was just rejected), falling back to Wikipedia when Tavily is
 * skipped or fails. Returns the results plus every attempt, skipped providers
 * included. Never throws.
 */
export async function webSearchDetailed(query: string, opts: { executionId?: string | null } = {}): Promise<{ results: SearchResult[]; attempts: SearchAttempt[] }> {
  const executionId = opts.executionId ?? null;
  const attempts: SearchAttempt[] = [];
  const q = collapse(query).slice(0, 300);
  if (!q) return { results: [], attempts };
  const provider = effectiveSearchProvider();
  if (provider === "off") return { results: [], attempts };
  let stage: SearchProviderName = provider;
  try {
    if (provider === "tavily") {
      const blocked = tavilyUnavailableReason();
      if (blocked) {
        attempts.push(skipped(q, "tavily", blocked));
      } else if ((await searchesToday("tavily")) >= config.search.dailyBudget) {
        attempts.push(skipped(q, "tavily", `skipped: today's search budget (SEARCH_DAILY_BUDGET=${config.search.dailyBudget}) is used up`));
      } else {
        const t = await tavilySearch(q, executionId);
        attempts.push(t.attempt);
        if (t.results) return { results: t.results, attempts };
      }
    }
    stage = "wikipedia";
    if ((await searchesToday("wikipedia")) >= WIKIPEDIA_DAILY_CAP()) {
      attempts.push(skipped(q, "wikipedia", "skipped: the daily Wikipedia safety cap is reached"));
      return { results: [], attempts };
    }
    const w = await wikipediaSearch(q, executionId);
    attempts.push(w.attempt);
    return { results: w.results, attempts };
  } catch (err) {
    // Internal problem (e.g. the database): reported as a failed attempt, never swallowed.
    log.warn("search.error", { provider: stage, executionId: executionId ?? undefined, error: errMsg(err) });
    attempts.push(skipped(q, stage, `search failed: ${clipError(errMsg(err))}`));
    return { results: [], attempts };
  }
}

/** Results only (see webSearchDetailed). Never throws. */
export async function webSearch(query: string, opts: { executionId?: string | null } = {}): Promise<SearchResult[]> {
  return (await webSearchDetailed(query, opts)).results;
}
