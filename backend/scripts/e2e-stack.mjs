// Starts the stack the Playwright E2E suite drives: a fresh database, the API
// with the embedded worker OFF, and a separate worker process — the same
// topology as production (render.yaml). AI is the deterministic mock provider
// with simulated latency; web search is off (evidence comes from the
// company context and documents the test enters).
//
//   node scripts/e2e-stack.mjs        (run from backend/, after `npm run build`)
//
// Env: E2E_DATABASE_URL, E2E_API_PORT (4100), E2E_WEB_ORIGIN (http://localhost:3100)

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
  SEARCH_PROVIDER: "off",
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
