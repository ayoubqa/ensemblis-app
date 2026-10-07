import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRegistered, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { toPublicWorkflow } from "../lib/serializers";
import { config } from "../config";
import { taskRunLimiter } from "../lib/rateLimits";
import { nextRunFrom, runWorkflow } from "./schedule";

const router = Router();
router.use(requireAuth);

// Guests (trial accounts) can't set up recurring work.
const registeredOnly = requireRegistered("set up recurring workflows");

const frequency = z.enum(["Weekly", "Monthly", "Quarterly"]);
const depth = z.enum(["focused", "standard", "deep"]);

async function ownWorkflow(userId: string, id: string) {
  const workflow = await prisma.workflow.findFirst({ where: { id, userId } });
  if (!workflow) throw new HttpError(404, "Workflow not found");
  return workflow;
}

router.get(
  "/",
  ah<AuthedRequest>(async (req, res) => {
    const workflows = await prisma.workflow.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ workflows: workflows.map(toPublicWorkflow) });
  })
);

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  basedOnText: z
    .string()
    .trim()
    .min(3, "Describe the recurring task")
    .max(config.maxDescriptionLength, `Description is too long (max ${config.maxDescriptionLength} characters)`),
  frequency: frequency.default("Monthly"),
  depth: depth.default("standard"),
  agentId: z.string().min(1).optional(),
});

router.post(
  "/",
  registeredOnly,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(createSchema, req.body);
    if (body.agentId) {
      const agent = await prisma.agent.findFirst({ where: { id: body.agentId, isLive: true } });
      if (!agent) throw new HttpError(404, "Agent not found");
    }
    const workflow = await prisma.workflow.create({
      data: { ...body, userId: req.userId!, isActive: true, nextRun: nextRunFrom(new Date(), body.frequency) },
    });
    res.status(201).json({ workflow: toPublicWorkflow(workflow) });
  })
);

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    frequency,
    depth,
    isActive: z.boolean(),
  })
  .partial()
  .strict();

router.patch(
  "/:id",
  registeredOnly,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(updateSchema, req.body ?? {});
    const existing = await ownWorkflow(req.userId!, req.params.id);
    const data: Record<string, unknown> = { ...body };
    const freq = body.frequency ?? existing.frequency;
    if (body.frequency && body.frequency !== existing.frequency) {
      data.nextRun = nextRunFrom(existing.lastRun ?? new Date(), freq);
    }
    // Re-activating: don't fire immediately for runs missed while paused.
    if (body.isActive === true && !existing.isActive) {
      const next = (data.nextRun as Date | undefined) ?? existing.nextRun;
      if (!next || next.getTime() < Date.now()) data.nextRun = nextRunFrom(new Date(), freq);
    }
    const workflow = await prisma.workflow.update({ where: { id: existing.id }, data });
    res.json({ workflow: toPublicWorkflow(workflow) });
  })
);

router.delete(
  "/:id",
  ah<AuthedRequest>(async (req, res) => {
    const existing = await ownWorkflow(req.userId!, req.params.id);
    await prisma.workflow.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

// Run a workflow's task now (also used by the scheduler, see schedule.ts).
router.post(
  "/:id/run",
  registeredOnly,
  taskRunLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const workflow = await ownWorkflow(req.userId!, req.params.id);
    const result = await runWorkflow(workflow);
    res.status(201).json(result);
  })
);

export default router;
