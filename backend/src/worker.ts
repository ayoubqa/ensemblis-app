// Standalone worker process: `npm run start:worker` (node dist/worker.js).
// Executes objectives from the durable queue and runs maintenance. Run one or
// more alongside the API (render.yaml: the `ensemblis-worker` service).

import "dotenv/config";
import { productionConfigProblems } from "./config";
import { prisma } from "./db";
import { log } from "./lib/log";
import { aiProviderLabel } from "./ai/llmProvider";
import { maintenance } from "./engine/maintenance";
import { Worker } from "./engine/worker";

async function main() {
  const problems = productionConfigProblems();
  if (problems.length) {
    for (const p of problems) log.error("config.problem", { problem: p });
    process.exit(1);
  }
  await prisma.$queryRaw`SELECT 1`;
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
