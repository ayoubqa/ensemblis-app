import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { runTask } from "./agentRunner";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: AuthedRequest, res) => {
  const tasks = await prisma.task.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    include: { agent: true },
  });
  res.json({ tasks });
});

router.get("/:id", async (req: AuthedRequest, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { agent: true },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ task });
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  agentId: z.string().optional(),
});

// Creates a task, charges the user's credits up front, and kicks off the real
// agent run in the background. The client polls GET /:id (or you can add
// Server-Sent Events) to watch it move from RUNNING to COMPLETED/FAILED.
router.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { title, description, agentId } = parsed.data;

  const agent = agentId
    ? await prisma.agent.findUnique({ where: { id: agentId } })
    : await prisma.agent.findFirst({ where: { isLive: true } });

  const cost = agent?.pricePerTaskCents ?? 1500;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (user.credits < cost) {
    return res.status(402).json({ error: "Insufficient credits", required: cost, available: user.credits });
  }

  const task = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.user.update({ where: { id: user.id }, data: { credits: { decrement: cost } } });
    return tx.task.create({
      data: {
        userId: user.id,
        agentId: agent?.id,
        title,
        description,
        costCents: cost,
        status: "PLANNING",
      },
    });
  });

  // Fire-and-forget: don't make the HTTP caller wait minutes for the result.
  runTask(task.id).catch((err) => console.error("runTask crashed:", err));

  res.status(201).json({ task });
});

const feedbackSchema = z.object({
  outcome: z.enum(["Achieved", "Partially", "Not achieved"]),
});

router.post("/:id/feedback", async (req: AuthedRequest, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid outcome" });

  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { outcome: parsed.data.outcome },
  });
  res.json({ task: updated });
});

export default router;
