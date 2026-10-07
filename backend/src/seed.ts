// Seeds the marketplace with the full Ensemblis agent catalog (20 agents from
// the design prototype), each with a real system prompt that is actually sent
// to the model when the agent runs a step of a task — and (v3) the curated
// example reports shown in the public gallery.
//
// Idempotent: agents are upserted by their unique name and gallery examples by
// slug, so re-running the seed refreshes content without duplicating rows.
// Live usage counters (tasksCompleted) are never decreased by a re-seed, and an
// example the owner hid from the gallery (isPublished=false) stays hidden.
//
// Lives in src/ so `npm run build` compiles it to dist/seed.js, which the
// production start command (`npm run start:render`) runs on every boot.
// Locally: `npm run seed`.

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { CATALOG } from "./catalog/agents";
import { GALLERY_EXAMPLES } from "./catalog/gallery";

async function seedAgents() {
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

async function seedGallery() {
  let seeded = 0;
  for (const ex of GALLERY_EXAMPLES) {
    const existing = await prisma.galleryItem.findUnique({ where: { slug: ex.slug }, select: { isExample: true } });
    if (existing && !existing.isExample) {
      console.warn(`Gallery: slug "${ex.slug}" is used by a featured report — example skipped.`);
      continue;
    }
    const content = {
      title: ex.title,
      category: ex.category,
      summary: ex.summary,
      content: ex.content,
      sources: ex.sources as unknown as Prisma.InputJsonValue,
      agentName: ex.agentName,
      depth: ex.depth,
      position: ex.position,
      isExample: true,
    };
    await prisma.galleryItem.upsert({
      where: { slug: ex.slug },
      update: content, // isPublished deliberately untouched
      create: { slug: ex.slug, ...content, isPublished: true },
    });
    seeded++;
  }
  console.log(`Seeded ${seeded} gallery example${seeded === 1 ? "" : "s"}.`);
}

async function main() {
  await seedAgents();
  await seedGallery();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
