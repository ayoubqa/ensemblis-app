import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { TASK_INCLUDE, toPublicTask } from "../lib/serializers";
import { config } from "../config";
import { estimateLimiter, taskRunLimiter } from "../lib/rateLimits";
import { createTaskForUser, estimate, retryTaskForUser, toPublicEstimate } from "./service";

const router = Router();

const depthSchema = z.enum(["focused", "standard", "deep"]);
const description = z
  .string({ required_error: "Describe the work you need done" })
  .trim()
  .min(3, "Describe the work you need done")
  .max(config.maxDescriptionLength, `Description is too long (max ${config.maxDescriptionLength} characters)`);

const estimateSchema = z.object({
  description,
  depth: depthSchema.optional(),
  agentId: z.string().min(1).optional(),
});

// Public: lets anyone see the plan, team and price before signing up. No charge.
router.post(
  "/estimate",
  estimateLimiter,
  ah(async (req, res) => {
    const body = parse(estimateSchema, req.body);
    const plan = await estimate(body.description, { depth: body.depth, agentId: body.agentId });
    res.json({ estimate: toPublicEstimate(plan) });
  })
);

router.use(requireAuth);

router.get(
  "/",
  ah<AuthedRequest>(async (req, res) => {
    const tasks = await prisma.task.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: TASK_INCLUDE,
    });
    res.json({ tasks: tasks.map(toPublicTask) });
  })
);

router.get(
  "/:id",
  ah<AuthedRequest>(async (req, res) => {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: TASK_INCLUDE,
    });
    if (!task) throw new HttpError(404, "Task not found");
    res.json({ task: toPublicTask(task) });
  })
);

const createSchema = estimateSchema.extend({
  title: z.string().trim().max(200).optional(),
});

// Re-estimates server-side, charges credits, creates the task + team steps,
// responds immediately, and runs the team in the background. The client polls
// GET /:id to watch steps move QUEUED -> RUNNING -> COMPLETED.
router.post(
  "/",
  taskRunLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(createSchema, req.body);
    const result = await createTaskForUser(req.userId!, body);
    res.status(201).json(result);
  })
);

router.post(
  "/:id/retry",
  taskRunLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const result = await retryTaskForUser(req.userId!, req.params.id);
    res.json(result);
  })
);

const feedbackSchema = z.object({
  outcome: z.enum(["Achieved", "Partially", "Not achieved"], {
    errorMap: () => ({ message: 'outcome must be "Achieved", "Partially" or "Not achieved"' }),
  }),
});

// Outcome ratings feed each agent's `achievedRate` (see agents/routes.ts and
// developer/routes.ts), computed live from these rows.
router.post(
  "/:id/feedback",
  ah<AuthedRequest>(async (req, res) => {
    const { outcome } = parse(feedbackSchema, req.body);
    const task = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!task) throw new HttpError(404, "Task not found");
    if (task.status === "RUNNING" || task.status === "PLANNING") {
      throw new HttpError(409, "You can rate a task once it has finished");
    }
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { outcome },
      include: TASK_INCLUDE,
    });
    res.json({ task: toPublicTask(updated) });
  })
);

export default router;
