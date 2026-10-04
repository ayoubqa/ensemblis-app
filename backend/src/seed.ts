// Seeds the marketplace with the full Ensemblis agent catalog (20 agents from
// the design prototype), each with a real system prompt that is actually sent
// to the model when the agent runs a step of a task.
//
// Idempotent: agents are upserted by their unique name, so re-running the seed
// refreshes descriptions/prompts/prices without duplicating rows. Live usage
// counters (tasksCompleted) are never decreased by a re-seed.
//
// Lives in src/ so `npm run build` compiles it to dist/seed.js, which the
// production start command (`npm run start:render`) runs on every boot.
// Locally: `npm run seed`.

import { prisma } from "./db";
import { CATALOG } from "./catalog/agents";

async function main() {
  for (const agent of CATALOG) {
    const existing = await prisma.agent.findUnique({ where: { name: agent.name } });
    const tasksCompleted = Math.max(existing?.tasksCompleted ?? 0, agent.tasksCompleted);
    await prisma.agent.upsert({
      where: { name: agent.name },
      update: { ...agent, tasksCompleted },
      create: { ...agent, isLive: true },
    });
  }
  console.log(`Seeded ${CATALOG.length} agents.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
