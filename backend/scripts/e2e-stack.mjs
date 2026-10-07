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
};

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
