// Standalone worker process: `npm run start:worker` (node dist/worker.js).
// Executes objectives from the durable queue and runs maintenance. Run one or
// more alongside the API (render.yaml: the `ensemblis-worker` service).

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { productionConfigProblems, productionConfigWarnings } from "./config";
import { prisma } from "./db";
import { log } from "./lib/log";
import { aiProviderLabel } from "./ai/llmProvider";
import { maintenance } from "./engine/maintenance";
import { Worker } from "./engine/worker";

const MIGRATIONS_DIR = path.resolve(__dirname, "../prisma/migrations");
const MIGRATION_WAIT_MS = Number(process.env.WORKER_MIGRATION_WAIT_MS) || 10 * 60_000;

/** Resolves once every migration this release ships is recorded as applied; exits after MIGRATION_WAIT_MS. */
export async function waitForMigrations(): Promise<void> {
  const expected = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const until = Date.now() + MIGRATION_WAIT_MS;
  let logged = false;
  for (;;) {
    const applied = await prisma
      .$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
      .then((rows) => new Set(rows.map((r) => r.migration_name)))
      .catch(() => new Set<string>()); // table not created yet
    const missing = expected.filter((m) => !applied.has(m));
    if (!missing.length) return;
    if (Date.now() > until) throw new Error(`database migrations not applied after ${Math.round(MIGRATION_WAIT_MS / 60000)} min: ${missing.join(", ")} — is the API's migration step failing?`);
    if (!logged) log.info("worker.waiting_for_migrations", { missing });
    logged = true;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function main() {
  const problems = productionConfigProblems("worker");
  if (problems.length) {
    for (const p of problems) log.error("config.problem", { problem: p });
    process.exit(1);
  }
  for (const w of productionConfigWarnings("worker")) log.warn("config.warning", { warning: w });
  await prisma.$queryRaw`SELECT 1`;
  // The API applies migrations at boot. During a deploy this new worker can start first: running new
  // code against the old schema would fail every job (and fail + refund executions), so wait.
  await waitForMigrations();
  const worker = new Worker({ maintenance, maintenanceMs: 30_000 });
  worker.start();
  log.info("worker.ready", { ai: aiProviderLabel() });
  const shutdown = async (signal: string) => {
    log.info("worker.shutdown", { signal });
    await worker.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker.crashed", { error: err });
  process.exit(1);
});
