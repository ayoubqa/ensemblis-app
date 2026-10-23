// A local stand-in for the Tavily search API (POST /search) and the Wikipedia
// API (GET /w/api.php: list=search, then prop=extracts|info), for the
// Playwright E2E stack (scripts/e2e-stack.mjs) and manual runs without network
// access. It is a STUB: it always answers with the fixed STUB_RESULTS below
// (the same fixtures as tests/stubSearch.ts), never with live web pages, and
// no result it serves may be presented as real research.
//
//   node scripts/search-stub.mjs [port]           (default port 4198)
//   SEARCH_STUB_MODE=401 node scripts/search-stub.mjs
//
// The API reaches it through TAVILY_BASE_URL=http://127.0.0.1:<port> (read by
// src/research/search.ts). The Wikipedia endpoint is fixed in search.ts, so
// the Wikipedia shape here is only used by callers that point at it directly.
//
// SEARCH_STUB_MODE (or opts.mode):
//   ok     Tavily answers STUB_RESULTS (default); Wikipedia answers them too
//   401    Tavily rejects the key (HTTP 401); Wikipedia answers STUB_RESULTS
//   500    Tavily and Wikipedia fail with HTTP 500 (Retry-After: 0)
//   empty  both answer, with no results

import http from "node:http";

export const STUB_RESULTS = [
  {
    title: "European data center market outlook 2027",
    url: "https://research.example.org/eu-datacenter-2027",
    content:
      "Germany is the largest European data center market with 2,450 MW of operational capacity in 2025. The Netherlands, Ireland and the Nordics follow, with the Nordics growing fastest at 18% per year.",
  },
  {
    title: "Liquid cooling adoption in Nordic data centers",
    url: "https://nordics.example.com/liquid-cooling",
    content: "Nordic operators report liquid cooling adoption of 34% in new builds, driven by high-density AI workloads and cheap renewable power.",
  },
  {
    title: "Ireland data center capacity constraints",
    url: "https://ireland.example.net/capacity",
    content: "Ireland's grid operator restricted new data center connections in Dublin until 2028, limiting near-term growth.",
  },
];

const MODES = ["ok", "401", "500", "empty"];

export function startSearchStub(port = 0, opts = {}) {
  const mode = String(opts.mode ?? process.env.SEARCH_STUB_MODE ?? "ok").trim().toLowerCase();
  if (!MODES.includes(mode)) throw new Error(`SEARCH_STUB_MODE must be one of ${MODES.join(", ")} (got "${mode}")`);
  let tavilyCalls = 0;
  let wikipediaCalls = 0;
  const queries = [];
  const json = (res, status, body, headers = {}) => res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://stub");

      if (req.method === "GET" && url.pathname.endsWith("/api.php")) {
        wikipediaCalls++;
        if (mode === "500") return json(res, 500, { error: { code: "stub", info: "stub error 500" } });
        const pages = (mode === "empty" ? [] : STUB_RESULTS).map((r, i) => ({ pageid: 1001 + i, ...r }));
        if (url.searchParams.get("list") === "search") {
          return json(res, 200, { query: { search: pages.map((p) => ({ pageid: p.pageid, title: p.title })) } });
        }
        const wanted = new Set((url.searchParams.get("pageids") ?? "").split("|").map(Number));
        const out = {};
        for (const p of pages) if (wanted.has(p.pageid)) out[String(p.pageid)] = { pageid: p.pageid, ns: 0, title: p.title, extract: p.content, fullurl: p.url };
        return json(res, 200, { query: { pages: out } });
      }

      if (req.method === "POST" && url.pathname.endsWith("/search")) {
        tavilyCalls++;
        if (!/^Bearer \S+/.test(req.headers.authorization || "")) return json(res, 401, { detail: { error: "Unauthorized: missing or invalid API key." } });
        try {
          const q = JSON.parse(body || "{}").query;
          if (typeof q === "string") queries.push(q);
        } catch {
          return json(res, 400, { detail: { error: "invalid JSON body" } });
        }
        if (mode === "401") return json(res, 401, { detail: { error: "Unauthorized: missing or invalid API key." } });
        if (mode === "500") return json(res, 500, { detail: { error: "Stub error 500" } }, { "Retry-After": "0" });
        return json(res, 200, { query: queries[queries.length - 1] ?? "", results: mode === "empty" ? [] : STUB_RESULTS });
      }

      res.writeHead(404).end();
    });
  });

  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        server,
        mode,
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}`,
        tavilyCalls: () => tavilyCalls,
        wikipediaCalls: () => wikipediaCalls,
        queries: () => [...queries],
        close: () => new Promise((r) => server.close(() => r())),
      })
    )
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stub = await startSearchStub(Number(process.argv[2]) || 4198);
  console.log(`Search stub (mode ${stub.mode}) on ${stub.url} — Tavily: POST /search, Wikipedia: GET /w/api.php. Fixed fixtures, not live results.`);
}
