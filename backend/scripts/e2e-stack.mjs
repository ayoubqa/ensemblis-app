// Starts the stack the Playwright E2E suite drives: a fresh database, the API
// with the embedded worker OFF, and a separate worker process — the same
// topology as production (render.yaml). AI is the deterministic MOCK provider
// with simulated latency (or, with PROD_LIKE=1, the real OpenAI-compatible
// provider code against a local Groq-format STUB). Web search is ON but goes
// to a local search STUB (scripts/search-stub.mjs, Tavily wire format, fixed
// fixtures): research briefs run through the real search/evidence code paths
// without network access. Nothing this stack produces is real research.
//
//   node scripts/e2e-stack.mjs        (run from backend/, after `npm run build`)
//
// Env: E2E_DATABASE_URL, E2E_API_PORT (4100), E2E_WEB_ORIGIN (http://localhost:3100),
//      SEARCH_STUB_MODE (ok | 401 | 500 | empty; default ok),
//      VERIFY_RETRY_DELAY_MS (default here 1000: the "could not be verified" path re-checks quickly)

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const db = process.env.E2E_DATABASE_URL || "postgresql://ensemblis:ensemblis@localhost:5432/ensemblis_e2e?schema=public";
const port = process.env.E2E_API_PORT || "4100";
const web = process.env.E2E_WEB_ORIGIN || "http://localhost:3100";

// PROD_LIKE=1: NODE_ENV=production and the real OpenAI-compatible provider code, pointed at a local
// stub that speaks Groq's streaming wire format (no network, no key, no mock provider).
const prodLike = process.env.PROD_LIKE === "1";
let stubUrl = "";
if (prodLike) {
  process.env.OPENAI_STUB_DELAY_MS ||= process.env.MOCK_AI_DELAY_MS || "1600";
  const { startOpenAIStub } = await import("./openai-stub.mjs");
  const { port } = await startOpenAIStub(0);
  stubUrl = `http://127.0.0.1:${port}/v1`;
  console.log(`[e2e-stack] production-like: NODE_ENV=production, AI_PROVIDER=openai → ${stubUrl}`);
}

// Web search: a local Tavily-format stub (never the real API, never a real key).
const { startSearchStub } = await import("./search-stub.mjs");
const search = await startSearchStub(0);
console.log(`[e2e-stack] web search → search stub ${search.url} (mode ${search.mode}; fixed fixtures, not live results)`);

const env = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: db,
  PORT: port,
  CORS_ORIGIN: web,
  APP_URL: web,
  JWT_SECRET: "e2e-secret-not-for-production-0123456789",
  AI_PROVIDER: "mock",
  MOCK_AI_DELAY_MS: process.env.MOCK_AI_DELAY_MS || "1600",
  SEARCH_PROVIDER: "tavily",
  TAVILY_API_KEY: "stub-key",
  // Not the public Tavily API: the product labels it a custom search endpoint (/api/config searchCustomEndpoint)
  // and, with PROD_LIKE=1, logs a boot warning — a warning only, so this stack still starts.
  TAVILY_BASE_URL: search.url,
  SEARCH_DAILY_BUDGET: "100000",
  // Marks this as a stub stack (the search and, with PROD_LIKE, the model are local stubs). Keep it in
  // both modes: with PROD_LIKE the model endpoint is labelled a test stub (config.ts modelEndpoint), and
  // every execution records it (endpoints.model "stub", endpoints.search "custom").
  E2E_STUB: "1",
  VERIFY_RETRY_DELAY_MS: process.env.VERIFY_RETRY_DELAY_MS || "1000",
  EMBEDDED_WORKER: "false",
  WORKER_POLL_MS: "250",
  DISABLE_SCHEDULER: "true",
  STARTING_CREDITS_CENTS: "10000",
  RATE_LIMIT_SIGNUP_PER_HOUR: "1000",
  RATE_LIMIT_LOGIN_PER_15MIN: "1000",
  RATE_LIMIT_GLOBAL_PER_15MIN: "100000",
  LOG_LEVEL: process.env.LOG_LEVEL || "warn",
  ...(prodLike
    ? { NODE_ENV: "production", AI_PROVIDER: "openai", OPENAI_BASE_URL: stubUrl, OPENAI_API_KEY: "stub-key", OPENAI_MODEL: "openai/gpt-oss-120b", OPENAI_FAST_MODEL: "openai/gpt-oss-20b", OPENAI_REASONING_EFFORT: "low" }
    : {}),
};

// This database is RESET on every run: refuse anything that doesn't look like a throwaway one.
const dbName = new URL(db).pathname.replace(/^\//, "");
if (!/e2e|test/i.test(dbName)) {
  console.error(`Refusing to reset "${dbName}": the database name must contain "e2e" or "test".`);
  process.exit(2);
}

const prisma = require.resolve("prisma/build/index.js");
const reset = spawnSync(process.execPath, [prisma, "migrate", "reset", "--force", "--skip-seed", "--skip-generate"], { env, stdio: "inherit" });
if (reset.status !== 0) process.exit(reset.status ?? 1);

const children = [
  spawn(process.execPath, ["dist/index.js"], { env, stdio: "inherit" }),
  spawn(process.execPath, ["dist/worker.js"], { env, stdio: "inherit" }),
];
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  void search.close();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (const c of children) c.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`[e2e-stack] a process exited with ${code}`);
    stop();
  }
});
