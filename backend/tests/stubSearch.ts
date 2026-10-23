// A local stand-in for the Tavily search API, so research runs through the
// real search/evidence code paths without network access.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "../src/config";
import { searchEndpoints } from "../src/research/search";

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

export async function startStubSearch(): Promise<{ close: () => Promise<void>; calls: () => number }> {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls++;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ results: STUB_RESULTS }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const before = { provider: config.search.provider, key: config.search.tavilyApiKey, url: searchEndpoints.tavily, budget: config.search.dailyBudget };
  config.search.provider = "tavily";
  config.search.tavilyApiKey = "test-key";
  config.search.dailyBudget = 1000;
  searchEndpoints.tavily = `http://127.0.0.1:${port}/search`;
  return {
    calls: () => calls,
    close: async () => {
      config.search.provider = before.provider;
      config.search.tavilyApiKey = before.key;
      config.search.dailyBudget = before.budget;
      searchEndpoints.tavily = before.url;
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
