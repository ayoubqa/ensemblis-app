import { Router } from "express";
import type { Agent } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, optionalAuth, requireDeveloper, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { toPublicAgent } from "../lib/serializers";
import { slugify } from "../catalog/agents";

const router = Router();

// Display order for categories (prototype CATS); unknown categories follow alphabetically.
const CATEGORY_ORDER = [
  "Research", "Marketing", "Sales", "Finance", "Development", "Operations", "Legal",
  "Design", "Customer Support", "Data", "Product", "Business Intelligence",
];
export function sortCategories(cats: string[]): string[] {
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...new Set(cats)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function recommendedScore(a: Agent): number {
  return (a.verified ? 10 : 0) + a.rating * 10 + a.reputation / 5 + a.successRate / 10 + Math.log10(a.tasksCompleted + 1) * 3;
}

const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  sort: z.enum(["recommended", "rating", "price", "tasks", "newest"]).optional(),
  verified: z.enum(["true", "false", "1", "0"]).optional(),
});

// Public: anyone can browse the marketplace, signed in or not.
router.get(
  "/",
  ah(async (req, res) => {
    const query = parse(listSchema, req.query);
    const all = await prisma.agent.findMany({ where: { isLive: true } });
    const categories = sortCategories(all.map((a) => a.category));

    let agents = all;
    if (query.category && query.category.toLowerCase() !== "all") {
      const c = query.category.toLowerCase();
      agents = agents.filter((a) => a.category.toLowerCase() === c);
    }
    if (query.verified === "true" || query.verified === "1") agents = agents.filter((a) => a.verified);
    if (query.q) {
      const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
      agents = agents.filter((a) => {
        const hay = [a.name, a.description, a.category, a.creator, a.specialty, a.taskType, a.outputType, ...a.capabilities]
          .join(" ")
          .toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }

    const sort = query.sort ?? "recommended";
    const sorters: Record<string, (a: Agent, b: Agent) => number> = {
      recommended: (a, b) => recommendedScore(b) - recommendedScore(a),
      rating: (a, b) => b.rating - a.rating || b.tasksCompleted - a.tasksCompleted,
      price: (a, b) => a.pricePerTaskCents - b.pricePerTaskCents || b.rating - a.rating,
      tasks: (a, b) => b.tasksCompleted - a.tasksCompleted,
      newest: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    };
    agents = [...agents].sort(sorters[sort]);

    res.json({ agents: agents.map(toPublicAgent), categories });
  })
);

// A developer's own published agents (live or not).
router.get(
  "/mine/list",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const agents = await prisma.agent.findMany({ where: { ownerId: req.userId }, orderBy: { createdAt: "desc" } });
    res.json({ agents: agents.map(toPublicAgent) });
  })
);

// Public, by id or slug. Signed-in viewers also get `inWorkforce` and their
// own recent tasks with this agent.
router.get(
  "/:idOrSlug",
  optionalAuth,
  ah<AuthedRequest>(async (req, res) => {
    const key = req.params.idOrSlug;
    const agent = await prisma.agent.findFirst({ where: { OR: [{ id: key }, { slug: key }] } });
    if (!agent || (!agent.isLive && agent.ownerId !== req.userId)) throw new HttpError(404, "Agent not found");

    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [tasksLast30d, rated, achieved, recent, member] = await Promise.all([
      prisma.task.count({ where: { agentId: agent.id, createdAt: { gte: since } } }),
      prisma.task.count({ where: { agentId: agent.id, outcome: { not: null } } }),
      prisma.task.count({ where: { agentId: agent.id, outcome: "Achieved" } }),
      req.userId
        ? prisma.task.findMany({
            where: { agentId: agent.id, userId: req.userId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, title: true, status: true, completedAt: true },
          })
        : Promise.resolve([]),
      req.userId
        ? prisma.workforceMember.findUnique({ where: { userId_agentId: { userId: req.userId, agentId: agent.id } } })
        : Promise.resolve(null),
    ]);

    res.json({
      agent: {
        ...toPublicAgent(agent),
        stats: {
          tasksLast30d,
          achievedRate: rated ? Math.round((achieved / rated) * 1000) / 10 : null,
          recentTasks: recent.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            completedAt: t.completedAt ? t.completedAt.toISOString() : null,
          })),
        },
        inWorkforce: !!member,
      },
    });
  })
);

const capabilities = z
  .array(z.string().trim().min(1).max(60))
  .min(1, "Add at least one capability")
  .max(12, "At most 12 capabilities");

const publishSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(80),
    category: z.string().trim().min(1, "Category is required").max(60),
    description: z.string().trim().min(10, "Description should be at least 10 characters").max(600),
    capabilities,
    specialty: z.string().trim().min(1, "Specialty is required").max(160),
    taskType: z.string().trim().min(1, "Task type is required").max(80),
    outputType: z.string().trim().min(1, "Output type is required").max(80),
    systemPrompt: z.string().trim().min(20, "System prompt should be at least 20 characters").max(20000),
    pricePerTaskCents: z.number().int().min(100, "Minimum price is €1").max(50000, "Maximum price is €500"),
    estMinutesLow: z.number().int().min(1).max(600),
    estMinutesHigh: z.number().int().min(1).max(600),
  })
  .refine((d) => d.estMinutesHigh >= d.estMinutesLow, {
    message: "estMinutesHigh must be at least estMinutesLow",
    path: ["estMinutesHigh"],
  });

function hueFor(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || "agent";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await prisma.agent.findFirst({ where: { slug, NOT: excludeId ? { id: excludeId } : undefined } });
    if (!clash) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// A developer publishing a new agent — the real version of the prototype's
// "Publish an agent" wizard. Goes live immediately (no moderation step yet).
router.post(
  "/",
  requireAuth,
  requireDeveloper,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(publishSchema, req.body);
    if (await prisma.agent.findUnique({ where: { name: body.name } })) {
      throw new HttpError(409, "An agent with that name already exists");
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const agent = await prisma.agent.create({
      data: {
        ...body,
        slug: await uniqueSlug(body.name),
        creator: user.company || user.name,
        priceFromCents: Math.max(100, Math.round((body.pricePerTaskCents * 0.6) / 100) * 100),
        avgRunSeconds: Math.round(((body.estMinutesLow + body.estMinutesHigh) / 2) * 60),
        // New agents start with no track record rather than borrowed numbers.
        successRate: 0,
        rating: 0,
        reputation: 50,
        tasksCompleted: 0,
        verified: false,
        hue: hueFor(body.name),
        isLive: true,
        ownerId: req.userId,
      },
    });
    res.status(201).json({ agent: toPublicAgent(agent) });
  })
);

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    category: z.string().trim().min(1).max(60),
    description: z.string().trim().min(10).max(600),
    capabilities,
    specialty: z.string().trim().min(1).max(160),
    taskType: z.string().trim().min(1).max(80),
    outputType: z.string().trim().min(1).max(80),
    systemPrompt: z.string().trim().min(20).max(20000),
    pricePerTaskCents: z.number().int().min(100).max(50000),
    estMinutesLow: z.number().int().min(1).max(600),
    estMinutesHigh: z.number().int().min(1).max(600),
    isLive: z.boolean(),
  })
  .partial()
  .strict();

// Owner-only edits. The slug stays stable so shared links keep working.
router.patch(
  "/:id",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(updateSchema, req.body ?? {});
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) throw new HttpError(404, "Agent not found");
    if (agent.ownerId !== req.userId) throw new HttpError(403, "You can only edit agents you published");

    const low = body.estMinutesLow ?? agent.estMinutesLow;
    const high = body.estMinutesHigh ?? agent.estMinutesHigh;
    if (high < low) throw new HttpError(400, "estMinutesHigh must be at least estMinutesLow");
    if (body.name && body.name !== agent.name) {
      const clash = await prisma.agent.findUnique({ where: { name: body.name } });
      if (clash) throw new HttpError(409, "An agent with that name already exists");
    }

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: {
        ...body,
        ...(body.estMinutesLow !== undefined || body.estMinutesHigh !== undefined
          ? { avgRunSeconds: Math.round(((low + high) / 2) * 60) }
          : {}),
        ...(body.pricePerTaskCents !== undefined
          ? { priceFromCents: Math.max(100, Math.round((body.pricePerTaskCents * 0.6) / 100) * 100) }
          : {}),
        ...(agent.slug ? {} : { slug: await uniqueSlug(body.name ?? agent.name, agent.id) }),
      },
    });
    res.json({ agent: toPublicAgent(updated) });
  })
);

export default router;
