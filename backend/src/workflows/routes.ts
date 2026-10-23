import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRegistered, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { toPublicWorkflow } from "../lib/serializers";
import { config } from "../config";
import { taskRunLimiter } from "../lib/rateLimits";
import { nextRunFrom, runWorkflow } from "./schedule";

// Recurring objectives (stored as Workflow rows). Each run creates a real
// objective for the Chief of Staff — see schedule.ts.
const router = Router();
router.use(requireAuth);

// Guests (trial accounts) can't set up recurring work.
const registeredOnly = requireRegistered("set up recurring objectives");

const frequency = z.enum(["Weekly", "Monthly", "Quarterly"]);

async function ownWorkflow(userId: string, id: string) {
  const workflow = await prisma.workflow.findFirst({ where: { id, userId } });
  if (!workflow) throw new HttpError(404, "Recurring objective not found");
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

const criteria = z.array(z.string().trim().min(3).max(300)).max(6);
const budget = z.number().int().min(500).max(50_000);
const autonomy = z.enum(["REVIEW_PLAN", "AUTO_WITHIN_BUDGET"]);

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  basedOnText: z
    .string()
    .trim()
    .min(10, "Describe the outcome this routine should deliver")
    .max(config.maxDescriptionLength, `Description is too long (max ${config.maxDescriptionLength} characters)`),
  frequency: frequency.default("Monthly"),
  successCriteria: criteria.default([]),
  budgetCents: budget.optional(),
  autonomy: autonomy.optional(),
});

router.post(
  "/",
  registeredOnly,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(createSchema, req.body);
    const workflow = await prisma.workflow.create({
      data: { ...body, depth: "standard", userId: req.userId!, isActive: true, nextRun: nextRunFrom(new Date(), body.frequency) },
    });
    res.status(201).json({ workflow: toPublicWorkflow(workflow) });
  })
);

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    frequency,
    isActive: z.boolean(),
    successCriteria: criteria,
    budgetCents: budget.nullable(),
    autonomy: autonomy.nullable(),
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

// Run now: creates this period's objective (the scheduler does the same, see schedule.ts).
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
