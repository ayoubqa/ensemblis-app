// Web research for the agents (v3). Two providers:
//
//   - Tavily (https://tavily.com) — real web search; needs TAVILY_API_KEY.
//     Free plan ≈ 1,000 searches/month, so calls are capped per UTC day by
//     SEARCH_DAILY_BUDGET. When today's budget is spent (or Tavily fails),
//     searches fall back to Wikipedia.
//   - Wikipedia — keyless, always available (English Wikipedia API).
//
// Never throws: any problem returns [] so research can't break a task.

import { config } from "../config";
import { prisma } from "../db";
import { recordUsage, startOfTodayUTC } from "../lib/usage";
import { collapse } from "./text";

export type SearchKind = "web" | "wikipedia";

export interface SearchResult {
  kind: SearchKind;
  title: string;
  url: string;
  /** Extracted text the agents read (bounded). */
  content: string;
  publishedAt: string | null;
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
// Wikipedia is free; this only guards against a runaway loop.
const WIKIPEDIA_DAILY_CAP = () => Math.max(1_000, config.search.dailyBudget * 10);

type Provider = "tavily" | "wikipedia" | "off";

/** The provider actually in use (Tavily without a key quietly means Wikipedia). */
export function effectiveSearchProvider(): Provider {
  const p = config.search.provider;
  if (p === "tavily" && !config.search.tavilyApiKey) return "wikipedia";
  return p;
}

export function searchEnabled(): boolean {
  return effectiveSearchProvider() !== "off";
}

export function searchProviderLabel(): string {
  const p = effectiveSearchProvider();
  return p === "tavily" ? "Tavily web search" : p === "wikipedia" ? "Wikipedia" : "Off";
}

function userAgent(): string {
  return `Ensemblis/1.0 (+${config.appUrl})`;
}

function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

async function searchesToday(provider: "tavily" | "wikipedia"): Promise<number> {
  return prisma.usageEvent.count({ where: { kind: "search", provider, createdAt: { gte: startOfTodayUTC() } } });
}

// ---------------------------------------------------------------- Tavily

/** Parses a Tavily /search response body into results (exported for tests). */
export function parseTavilyResponse(data: unknown): SearchResult[] {
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
    out.push({ kind: "web", title, url, content, publishedAt: published || null });
  }
  return out;
}

/** Returns results, or null when the call failed (caller falls back to Wikipedia). */
async function tavilySearch(query: string, executionId: string | null): Promise<SearchResult[] | null> {
  let ok = false;
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
      const body = (await res.text().catch(() => "")).slice(0, 200);
      console.warn(`[search] Tavily returned HTTP ${res.status}${body ? `: ${body}` : ""} — falling back to Wikipedia`);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data) return null;
    ok = true;
    return parseTavilyResponse(data);
  } catch (err) {
    console.warn(`[search] Tavily failed (${err instanceof Error ? err.message : err}) — falling back to Wikipedia`);
    return null;
  } finally {
    await recordUsage({ kind: "search", provider: "tavily", ok, executionId });
  }
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
export function parseWikipediaPages(data: unknown, pageIds: number[]): SearchResult[] {
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
    out.push({ kind: "wikipedia", title: `${title} — Wikipedia`, url, content, publishedAt: null });
  }
  return out;
}

async function wikiGet(params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, format: "json" }).toString();
  const res = await fetch(`${searchEndpoints.wikipedia}?${qs}`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Wikipedia returned HTTP ${res.status}`);
  return res.json();
}

async function wikipediaSearch(query: string, executionId: string | null): Promise<SearchResult[]> {
  let ok = false;
  try {
    const ids = parseWikipediaSearch(await wikiGet({ action: "query", list: "search", srsearch: query, srlimit: "3" }));
    if (!ids.length) {
      ok = true;
      return [];
    }
    const pages = await wikiGet({
      action: "query",
      prop: "extracts|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      exlimit: String(ids.length),
      pageids: ids.join("|"),
    });
    ok = true;
    return parseWikipediaPages(pages, ids);
  } catch (err) {
    console.warn(`[search] Wikipedia failed: ${err instanceof Error ? err.message : err}`);
    return [];
  } finally {
    await recordUsage({ kind: "search", provider: "wikipedia", ok, executionId });
  }
}

// ---------------------------------------------------------------- public

/** Which backend the next search will use (Tavily only while today's budget lasts). Never throws. */
export async function activeSearchBackend(): Promise<Provider> {
  const provider = effectiveSearchProvider();
  if (provider !== "tavily") return provider;
  try {
    return (await searchesToday("tavily")) < config.search.dailyBudget ? "tavily" : "wikipedia";
  } catch {
    return "tavily";
  }
}

/**
 * Searches with the configured provider, respecting today's Tavily budget
 * (falls back to Wikipedia). Never throws.
 */
export async function webSearch(query: string, opts: { executionId?: string | null } = {}): Promise<SearchResult[]> {
  const executionId = opts.executionId ?? null;
  try {
    const q = collapse(query).slice(0, 300);
    if (!q) return [];
    const provider = effectiveSearchProvider();
    if (provider === "off") return [];
    if (provider === "tavily") {
      const used = await searchesToday("tavily");
      if (used < config.search.dailyBudget) {
        const results = await tavilySearch(q, executionId);
        if (results) return results;
      }
    }
    if ((await searchesToday("wikipedia")) >= WIKIPEDIA_DAILY_CAP()) return [];
    return await wikipediaSearch(q, executionId);
  } catch (err) {
    console.warn(`[search] search failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
