import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";

const router = Router();

// Public: anyone can browse the marketplace, signed in or not.
router.get("/", async (_req, res) => {
  const agents = await prisma.agent.findMany({
    where: { isLive: true },
    orderBy: { tasksCompleted: "desc" },
  });
  res.json({ agents });
});

router.get("/:id", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json({ agent });
});

const publishSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  pricePerTaskCents: z.number().int().positive(),
});

// A developer publishing a new agent — this is the real version of the
// prototype's "Publish an agent" wizard. It goes live immediately here;
// add a review/approval step before launch if you want moderation.
router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const agent = await prisma.agent.create({
    data: { ...parsed.data, ownerId: req.userId },
  });
  res.status(201).json({ agent });
});

// A developer's own published agents + their performance.
router.get("/mine/list", requireAuth, async (req: AuthedRequest, res) => {
  const agents = await prisma.agent.findMany({ where: { ownerId: req.userId } });
  res.json({ agents });
});

export default router;
