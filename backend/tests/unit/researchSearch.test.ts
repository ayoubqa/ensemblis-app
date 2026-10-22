// Web research must say what really happened: which provider answered, which
// failed and why, and whether anything was found — never a silent fallback.
// Runs against the local Tavily + Wikipedia stub (tests/stubSearch.ts).
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { config, customTavilyBaseUrl } from "../../src/config";
import { publicConfig } from "../../src/public/config";
import {
  activeSearchBackend,
  currentSearchEndpoint,
  effectiveSearchProvider,
  parseTavilyResponse,
  parseWikipediaPages,
  parseWikipediaSearch,
  searchCustomEndpoint,
  searchEnabled,
  searchProviderLabel,
  webSearchDetailed,
  type SearchResult,
} from "../../src/research/search";
import { mergeResults, research, summarizeAttempts, type ResearchRequest } from "../../src/research/sources";
import { STUB_RESULTS, UNSAFE_RESULTS, startStubSearch, type StubSearch } from "../stubSearch";

const saved = { provider: config.search.provider, key: config.search.tavilyApiKey, budget: config.search.dailyBudget };
let stub: StubSearch | null = null;
afterEach(async () => {
  if (stub) await stub.close();
  stub = null;
  config.search.provider = saved.provider;
  config.search.tavilyApiKey = saved.key;
  config.search.dailyBudget = saved.budget;
});

const REQ: ResearchRequest = {
  topic: "European data center market — Market research",
  brief: "Recommend the three best European markets for our liquid-cooling product.",
  queryCount: 3,
  maxResults: 6,
};

const result = (url: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  kind: "web",
  title: url,
  url,
  content: "text",
  publishedAt: null,
  provider: "tavily",
  query: "q",
  ...extra,
});

describe("parsers", () => {
  it("parseTavilyResponse keeps http(s) results with text, tagged with provider and query", () => {
    const parsed = parseTavilyResponse(
      {
        results: [
          ...STUB_RESULTS,
          { title: "No text", url: "https://empty.example.org", content: "   " },
          { title: "", url: "https://untitled.example.org/x", content: "Some text", published_date: "2026-01-02" },
          ...UNSAFE_RESULTS,
          "junk",
        ],
      },
      "eu data centers"
    );
    expect(parsed.map((r) => r.url)).not.toContain("javascript:alert(document.cookie)");
    expect(parsed.find((r) => r.url === "https://untitled.example.org/x")).toMatchObject({ title: "untitled.example.org", publishedAt: "2026-01-02" });
    expect(parsed.filter((r) => r.url.startsWith("https://research.example.org"))).toHaveLength(1);
    expect(parsed.every((r) => r.provider === "tavily" && r.query === "eu data centers" && r.kind === "web")).toBe(true);
    expect(parseTavilyResponse({ nope: true })).toEqual([]);
    expect(parseTavilyResponse(null)).toEqual([]);
  });

  it("parseWikipediaSearch and parseWikipediaPages keep rank order and skip missing pages", () => {
    expect(parseWikipediaSearch({ query: { search: [{ pageid: 3 }, { pageid: 1 }, { pageid: 3 }, { pageid: -1 }, { title: "x" }] } })).toEqual([3, 1]);
    expect(parseWikipediaSearch({})).toEqual([]);
    const pages = parseWikipediaPages(
      {
        query: {
          pages: {
            "1": { pageid: 1, title: "Data center", extract: "A data center is a building.", fullurl: "https://en.wikipedia.org/wiki/Data_center" },
            "3": { pageid: 3, title: "Liquid cooling", extract: "Liquid cooling removes heat." },
            "4": { pageid: 4, title: "Gone", missing: "" },
          },
        },
      },
      [3, 1, 4],
      "data center"
    );
    expect(pages.map((p) => p.title)).toEqual(["Liquid cooling — Wikipedia", "Data center — Wikipedia"]);
    expect(pages[0].url).toBe("https://en.wikipedia.org/wiki/Liquid_cooling");
    expect(pages.every((p) => p.provider === "wikipedia" && p.kind === "wikipedia" && p.query === "data center")).toBe(true);
  });

  it("mergeResults interleaves by rank, de-duplicates by normalised URL and respects seen URLs and the cap", () => {
    const a = [result("https://a.example.org/1"), result("https://b.example.org/2?utm_source=x")];
    const b = [result("https://www.b.example.org/2"), result("https://c.example.org/3"), result("https://d.example.org/4")];
    const seen = new Set(["https://d.example.org/4"]);
    const merged = mergeResults([a, b], seen, 10);
    expect(merged.map((r) => r.url)).toEqual(["https://a.example.org/1", "https://www.b.example.org/2", "https://c.example.org/3"]);
    expect(mergeResults([a, b], new Set(), 2)).toHaveLength(2);
  });
});

describe("configuration", () => {
  it("Tavily without a key is effectively Wikipedia, and the public config says so", () => {
    config.search.provider = "tavily";
    config.search.tavilyApiKey = "";
    expect(effectiveSearchProvider()).toBe("wikipedia");
    expect(searchEnabled()).toBe(true);
    expect(searchProviderLabel()).toBe("Wikipedia");
    expect(publicConfig()).toMatchObject({ searchEnabled: true, searchProvider: "wikipedia", searchProviderLabel: "Wikipedia" });
  });

  it("off is off", () => {
    config.search.provider = "off";
    expect(searchEnabled()).toBe(false);
    expect(publicConfig()).toMatchObject({ searchEnabled: false, searchProvider: "off", searchProviderLabel: "Off" });
  });

  it("with a key, Tavily is used", () => {
    config.search.provider = "tavily";
    config.search.tavilyApiKey = "tvly-something";
    expect(publicConfig()).toMatchObject({ searchEnabled: true, searchProvider: "tavily", searchProviderLabel: "Tavily web search", searchCustomEndpoint: false });
  });

  it("Tavily at another endpoint (TAVILY_BASE_URL: a stub or proxy) is never presented as the public Tavily API", async () => {
    stub = await startStubSearch();
    expect(searchCustomEndpoint()).toBe(true);
    expect(searchProviderLabel()).toBe("Custom search endpoint (TAVILY_BASE_URL) — not the public Tavily API");
    expect(publicConfig()).toMatchObject({ searchProvider: "tavily", searchCustomEndpoint: true, searchProviderLabel: expect.stringMatching(/not the public Tavily API/) });
    // Without a Tavily key the endpoint is never called: Wikipedia, no custom-endpoint flag.
    config.search.tavilyApiKey = "";
    expect(publicConfig()).toMatchObject({ searchProvider: "wikipedia", searchProviderLabel: "Wikipedia", searchCustomEndpoint: false });
  });

  it("every search request records where it went (the stub is custom, Wikipedia public); a skipped provider records nothing", async () => {
    config.search.provider = "tavily";
    config.search.tavilyApiKey = "tvly-something";
    expect(currentSearchEndpoint()).toBe("public");
    stub = await startStubSearch({ status: 401, wikipedia: STUB_RESULTS.slice(0, 1) });
    expect(currentSearchEndpoint()).toBe("custom");
    const first = await webSearchDetailed("european data centers");
    expect(first.attempts.map((a) => [a.provider, a.ok, a.endpoint])).toEqual([
      ["tavily", false, "custom"],
      ["wikipedia", true, "public"],
    ]);
    // The 401 tripped the circuit breaker: Tavily is skipped without a request.
    const second = await webSearchDetailed("nordic data centers");
    expect(second.attempts.map((a) => [a.provider, a.endpoint])).toEqual([
      ["tavily", undefined],
      ["wikipedia", "public"],
    ]);
    config.search.provider = "off";
    expect(currentSearchEndpoint()).toBeNull();
  });

  it("TAVILY_BASE_URL counts as custom unless it is the public API", () => {
    const prev = process.env.TAVILY_BASE_URL;
    try {
      delete process.env.TAVILY_BASE_URL;
      expect(customTavilyBaseUrl()).toBeNull();
      process.env.TAVILY_BASE_URL = "https://api.tavily.com/";
      expect(customTavilyBaseUrl()).toBeNull();
      process.env.TAVILY_BASE_URL = " http://127.0.0.1:4198/ ";
      expect(customTavilyBaseUrl()).toBe("http://127.0.0.1:4198");
    } finally {
      if (prev === undefined) delete process.env.TAVILY_BASE_URL;
      else process.env.TAVILY_BASE_URL = prev;
    }
  });
});

describe("research() status", () => {
  it("ok: every search worked; results carry provider and query", async () => {
    stub = await startStubSearch();
    const r = await research(REQ);
    expect(r.status).toBe("ok");
    expect(r.reason).toBeNull();
    expect(r.backend).toBe("tavily");
    expect(r.providersUsed).toEqual(["tavily"]);
    expect(r.queries.length).toBeGreaterThan(0);
    expect(r.attempts).toHaveLength(r.queries.length);
    expect(r.attempts.every((a) => a.provider === "tavily" && a.ok && a.httpStatus === 200 && a.resultCount === STUB_RESULTS.length && a.error === null)).toBe(true);
    expect(r.results.map((x) => x.url)).toEqual(STUB_RESULTS.map((x) => x.url));
    expect(r.results.every((x) => x.provider === "tavily" && r.queries.includes(x.query))).toBe(true);
    expect(stub.tavilyCalls()).toBe(r.queries.length);
    expect(stub.wikipediaCalls()).toBe(0);
  });

  it("degraded: Tavily rejects the key → Wikipedia answers, and Tavily is skipped for the rest of the run", async () => {
    stub = await startStubSearch({ status: 401, wikipedia: STUB_RESULTS });
    const r = await research(REQ);
    expect(r.status).toBe("degraded");
    expect(r.providersUsed).toEqual(["wikipedia"]);
    expect(r.reason).toMatch(/Tavily: HTTP 401/);
    expect(r.attempts[0]).toMatchObject({ provider: "tavily", ok: false, httpStatus: 401 });
    expect(r.attempts[0].error).toMatch(/invalid API key/);
    expect(r.attempts[1]).toMatchObject({ provider: "wikipedia", ok: true, resultCount: STUB_RESULTS.length });
    // Circuit breaker: one rejected call, then Tavily is skipped (and says why) instead of being retried per query.
    expect(stub.tavilyCalls()).toBe(1);
    const skippedAttempts = r.attempts.filter((a) => a.provider === "tavily" && a.httpStatus === null);
    expect(skippedAttempts).toHaveLength(r.queries.length - 1);
    expect(skippedAttempts.every((a) => /rejected the API key/.test(a.error ?? ""))).toBe(true);
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((x) => x.provider === "wikipedia" && x.kind === "wikipedia")).toBe(true);
    expect(await activeSearchBackend()).toBe("wikipedia");
    // The failed Tavily call is metered with its reason.
    const failed = await prisma.usageEvent.findFirst({ where: { kind: "search", provider: "tavily", ok: false } });
    expect(failed?.error).toMatch(/HTTP 401/);
  });

  it("no_results: the searches worked but found nothing", async () => {
    stub = await startStubSearch({ results: [] });
    const r = await research(REQ);
    expect(r.status).toBe("no_results");
    expect(r.providersUsed).toEqual(["tavily"]);
    expect(r.results).toEqual([]);
    expect(r.reason).toMatch(/found nothing/);
  });

  it("failed: every provider failed, with the reasons", async () => {
    stub = await startStubSearch({ status: 500, retryAfter: "0", wikipedia: 503 });
    const r = await research(REQ);
    expect(r.status).toBe("failed");
    expect(r.providersUsed).toEqual([]);
    expect(r.results).toEqual([]);
    expect(r.reason).toMatch(/Tavily: HTTP 500.*after 1 retry/);
    expect(r.reason).toMatch(/Wikipedia: HTTP 503/);
    // One retry per query for the 5xx.
    expect(stub.tavilyCalls()).toBe(2 * r.queries.length);
    expect(r.attempts.filter((a) => a.provider === "wikipedia").every((a) => !a.ok && a.httpStatus === 503)).toBe(true);
  });

  it("an internal error is 'failed' with the reason, not 'off'", async () => {
    stub = await startStubSearch();
    const req = { ...REQ } as ResearchRequest;
    Object.defineProperty(req, "seenUrls", {
      get() {
        throw new Error("boom with tvly-SECRETCANARY123456");
      },
    });
    const r = await research(req);
    expect(r.status).toBe("failed");
    expect(r.reason).toMatch(/Research failed: boom/);
    expect(r.reason).not.toMatch(/SECRETCANARY/);
    expect(r.backend).toBe("tavily");
  });

  it("off: no searches, and the reason says search is off", async () => {
    config.search.provider = "off";
    const r = await research(REQ);
    expect(r).toMatchObject({ status: "off", backend: "off", providersUsed: [], attempts: [], results: [], queries: [], queryWriter: "none" });
    expect(r.reason).toMatch(/search is off/i);
  });

  it("summarizeAttempts: degraded when a fallback was used, failed with no attempts", () => {
    expect(summarizeAttempts([]).status).toBe("failed");
    const a = { query: "q", httpStatus: 200, error: null, ms: 1 };
    expect(
      summarizeAttempts([
        { ...a, provider: "tavily", ok: false, httpStatus: null, error: "skipped: today's search budget is used up", resultCount: 0 },
        { ...a, provider: "wikipedia", ok: true, resultCount: 2 },
      ])
    ).toMatchObject({ status: "degraded", providersUsed: ["wikipedia"] });
  });
});

describe("Tavily reliability", () => {
  it("retries once on a 503 and succeeds", async () => {
    stub = await startStubSearch({ failFirst: 1, retryAfter: "0" });
    const { results, attempts } = await webSearchDetailed("european data centers");
    expect(attempts).toEqual([expect.objectContaining({ provider: "tavily", ok: true, httpStatus: 200, resultCount: STUB_RESULTS.length })]);
    expect(results).toHaveLength(STUB_RESULTS.length);
    expect(stub.tavilyCalls()).toBe(2);
  });

  it("does not retry a 429 that asks for a long wait; falls back to Wikipedia", async () => {
    stub = await startStubSearch({ status: 429, retryAfter: "30", wikipedia: STUB_RESULTS.slice(0, 1) });
    const { results, attempts } = await webSearchDetailed("european data centers");
    expect(stub.tavilyCalls()).toBe(1);
    expect(attempts.map((a) => [a.provider, a.ok, a.httpStatus])).toEqual([
      ["tavily", false, 429],
      ["wikipedia", true, 200],
    ]);
    expect(results.map((r) => r.provider)).toEqual(["wikipedia"]);
  });

  it("the daily budget counts only successful Tavily calls", async () => {
    stub = await startStubSearch({ status: 500, retryAfter: "0" });
    config.search.dailyBudget = 1;
    const first = await webSearchDetailed("first query");
    expect(first.attempts[0]).toMatchObject({ provider: "tavily", ok: false, httpStatus: 500 });
    expect(await prisma.usageEvent.count({ where: { kind: "search", provider: "tavily", ok: false } })).toBe(2);
    // Two failed calls, budget 1: Tavily is still available.
    expect(await activeSearchBackend()).toBe("tavily");

    stub.set({ status: 200 });
    const second = await webSearchDetailed("second query");
    expect(second.attempts).toEqual([expect.objectContaining({ provider: "tavily", ok: true })]);
    expect(await activeSearchBackend()).toBe("wikipedia");

    const third = await webSearchDetailed("third query");
    expect(third.attempts[0]).toMatchObject({ provider: "tavily", ok: false, httpStatus: null });
    expect(third.attempts[0].error).toMatch(/budget/);
    expect(third.attempts[1]).toMatchObject({ provider: "wikipedia", ok: true });
    expect(stub.tavilyCalls()).toBe(3);
  });
});

describe("safeHttpUrl (search result URLs)", () => {
  it("keeps public http(s) URLs", async () => {
    const { safeHttpUrl } = await import("../../src/research/search");
    expect(safeHttpUrl("https://www.example.com/report?id=1")).toBe("https://www.example.com/report?id=1");
    expect(safeHttpUrl("http://93.184.216.34/page")).toBe("http://93.184.216.34/page");
    expect(safeHttpUrl("https://example.com./a")).toBe("https://example.com./a");
    expect(safeHttpUrl("http://[2606:4700:4700::1111]/")).toBe("http://[2606:4700:4700::1111]/");
  });
  it("drops non-public names written with a trailing dot, and single-label names", async () => {
    const { safeHttpUrl } = await import("../../src/research/search");
    for (const bad of ["http://localhost./x", "http://localhost../x", "http://foo.internal./", "http://printer.local./", "http://intranet/", "http://intranet./", "https://./"]) {
      expect(safeHttpUrl(bad), bad).toBeNull();
    }
  });
  it("drops non-http schemes, embedded credentials and non-public hosts", async () => {
    const { safeHttpUrl } = await import("../../src/research/search");
    for (const bad of [
      "javascript:alert(1)",
      "ftp://example.com/file",
      "https://user:pass@example.com/",
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:8080/",
      "http://10.0.0.5/admin",
      "http://192.168.1.1/",
      "http://[::1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://localhost/",
      "http://metadata.google.internal/",
      "http://printer.local/",
      "not a url",
    ]) {
      expect(safeHttpUrl(bad), bad).toBeNull();
    }
  });
});
