// Real-process recovery check: the API and a separate worker run as their own
// processes against a throwaway database. Mid-step, the worker is
//   1. killed with SIGKILL (a crash / OOM / host loss), and
//   2. stopped with SIGTERM (a deploy),
// then a fresh worker is started. Each execution must still finish, be
// charged exactly once, and never be left RUNNING.
//
//   cd backend && npm run build && npm run check:worker-restart
//
// Env: RESTART_DATABASE_URL (default: local ensemblis_restart database).
// Uses the mock AI provider with simulated latency; no network needed.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const db = process.env.RESTART_DATABASE_URL || "postgresql://ensemblis:ensemblis@localhost:5432/ensemblis_restart?schema=public";
const PORT = "4110";
const API = `http://localhost:${PORT}`;
const LEASE_MS = 6000;

const env = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: db,
  PORT,
  CORS_ORIGIN: "http://localhost:3110",
  JWT_SECRET: "restart-check-secret-0123456789abcdef",
  AI_PROVIDER: "mock",
  MOCK_AI_DELAY_MS: "5000",
  SEARCH_PROVIDER: "off",
  EMBEDDED_WORKER: "false",
  WORKER_POLL_MS: "250",
  WORKER_LEASE_MS: String(LEASE_MS),
  STEP_RETRY_DELAYS_MS: "500,500,500",
  DISABLE_SCHEDULER: "true",
  STARTING_CREDITS_CENTS: "10000",
  RATE_LIMIT_SIGNUP_PER_HOUR: "1000",
  LOG_LEVEL: process.env.LOG_LEVEL || "warn",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, msg) => {
  results.push({ ok, msg });
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
};

// This database is RESET on every run: refuse anything that doesn't look like a throwaway one.
const dbName = new URL(db).pathname.replace(/^\//, "");
if (!/restart|test/i.test(dbName)) {
  console.error(`Refusing to reset "${dbName}": the database name must contain "restart" or "test".`);
  process.exit(2);
}

const prisma = require.resolve("prisma/build/index.js");
const reset = spawnSync(process.execPath, [prisma, "migrate", "reset", "--force", "--skip-seed", "--skip-generate"], { env, stdio: "ignore" });
if (reset.status !== 0) {
  console.error("could not reset the check database (is Postgres running?)");
  process.exit(1);
}

const procs = new Set();
function start(script, name) {
  const p = spawn(process.execPath, [script], { env, stdio: ["ignore", "inherit", "inherit"] });
  p.name = name;
  procs.add(p);
  p.on("exit", () => procs.delete(p));
  return p;
}
const exited = (p) => new Promise((r) => (p.exitCode !== null || p.signalCode ? r() : p.once("exit", r)));

async function call(method, path, token, body) {
  const r = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

async function waitFor(fn, ms, label) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await sleep(300);
  }
}

async function scenario(token, signal) {
  const { objective } = await call("POST", "/api/objectives", token, {
    statement: "Analyze the European market for our liquid-cooling product and recommend the three highest-potential markets for expansion.",
    successCriteria: [{ description: "Recommend 3 markets, ranked" }],
    budgetCents: 5000,
    autonomy: "AUTO_WITHIN_BUDGET",
  });
  const exec = async () => (await call("GET", `/api/objectives/${objective.id}`, token)).execution;
  // Wait until a work step (not the first one) is being written.
  const running = await waitFor(async () => {
    const e = await exec();
    return e && e.status === "RUNNING" && e.steps.some((s) => s.status === "RUNNING" && s.order >= 1) ? e : null;
  }, 90_000, "a running step");
  const step = running.steps.find((s) => s.status === "RUNNING");
  const worker = [...procs].find((p) => p.name.startsWith("worker"));
  worker.kill(signal);
  await exited(worker);
  console.log(`      ${signal} sent to the worker while "${step.title}" was running`);
  await sleep(signal === "SIGKILL" ? 1500 : 500);
  // Nothing processes jobs now; the execution must not have advanced to a terminal state by itself.
  const mid = await exec();
  check(["RUNNING", "VERIFYING"].includes(mid.status), `${signal}: execution stays in progress while no worker runs (status ${mid.status})`);
  start("dist/worker.js", `worker-after-${signal}`);
  const done = await waitFor(async () => {
    const e = await exec();
    return e && ["COMPLETED", "FAILED", "CANCELLED", "BLOCKED"].includes(e.status) ? e : null;
  }, 240_000, "the execution to finish");
  check(done.status === "COMPLETED", `${signal}: execution finished after restart (status ${done.status}${done.errorMessage ? `: ${done.errorMessage}` : ""})`);
  const again = done.steps.find((s) => s.id === step.id);
  // SIGKILL: the lease expires and the step is re-run. SIGTERM: the stopping worker drains its in-flight step first.
  check(again && again.status === "COMPLETED", `${signal}: the step that was running ("${step.title}") completed — ${again && again.attempts > 1 ? `re-run after the lease expired (attempt ${again.attempts})` : "finished by the stopping worker before it exited"}`);
  check(done.steps.every((s) => s.status === "COMPLETED" || s.status === "SKIPPED"), `${signal}: no step left RUNNING or PENDING`);
  const { transactions } = await call("GET", "/api/billing", token);
  const charges = transactions.filter((t) => t.type === "TASK_CHARGE" && t.executionId === done.id);
  check(charges.length === 1, `${signal}: charged exactly once (${charges.length} charge transaction${charges.length === 1 ? "" : "s"})`);
  const refunds = transactions.filter((t) => t.type === "REFUND" && t.executionId === done.id);
  const charged = -charges.reduce((n, t) => n + t.amountCents, 0);
  const refunded = refunds.reduce((n, t) => n + t.amountCents, 0);
  check(charged === done.costCents && refunded === (done.refundedCents ?? 0), `${signal}: ledger matches the execution (charged ${charged}/${done.costCents}, refunded ${refunded}/${done.refundedCents ?? 0})`);
  const { events } = await call("GET", `/api/executions/${done.id}/events`, token);
  const completedEvents = events.filter((e) => e.type === "STEP_COMPLETED" && e.stepId === step.id);
  check(completedEvents.length === 1, `${signal}: the interrupted step has exactly one STEP_COMPLETED event (${completedEvents.length})`);
  return done;
}

let code = 0;
try {
  start("dist/index.js", "api");
  await waitFor(async () => (await fetch(`${API}/health/live`).then((r) => r.ok).catch(() => false)), 30_000, "the API");
  start("dist/worker.js", "worker-1");
  const { token } = await call("POST", "/api/auth/signup", null, { name: "Restart Check", email: "restart-check@example.com", password: "correct-horse-battery-7", acceptedTerms: true, company: "Coolstack" });
  await call("PUT", "/api/context", token, {
    companyName: "Coolstack",
    description: "Coolstack makes liquid-cooling systems for data centers.",
    customers: "Colocation providers and hyperscale data-center operators.",
    markets: "Germany and the Netherlands today.",
  });
  await scenario(token, "SIGKILL");
  await scenario(token, "SIGTERM");
  const health = await fetch(`${API}/health`).then((r) => r.json());
  check(health.queue && health.queue.deadLast24h === 0, `queue health after both restarts: ${JSON.stringify(health.queue)}`);
} catch (err) {
  check(false, String(err && err.message ? err.message : err));
} finally {
  for (const p of procs) p.kill("SIGTERM");
  await Promise.all([...procs].map(exited));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  code = failed ? 1 : 0;
}
process.exit(code);
