// /api/objectives — define outcomes, list them, open one.
// Every query is scoped to the caller's organization (req.org from requireOrg).

import { Router } from "express";
import { z } from "zod";
import type { ObjectiveStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { requireAuth } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { limiter, taskRunLimiter } from "../lib/rateLimits";
import { requireOrg, type OrgRequest } from "../org/organization";
import { formatCompanyProfile, getCompanyContext } from "../context/service";
import { cleanText } from "../research/text";
import { createObjective, MAX_BUDGET_CENTS, MIN_BUDGET_CENTS, planDraft, replaceCriteria, suggestForStatement } from "../engine/objectives";
import { newAttempt } from "../engine/lifecycle";
import { FULL_EXECUTION_INCLUDE, toExecutionSummary, toPublicExecution, toPublicObjective, type FullExecution } from "../engine/serialize";

const router = Router();
router.use(requireAuth, requireOrg);

const statement = z
  .string({ required_error: "Describe the outcome you need" })
  .transform((s) => cleanText(s).trim())
  .pipe(
    z
      .string()
      .min(10, "Describe the outcome you need in a sentence or two")
      .max(config.maxDescriptionLength, `The objective is too long (max ${config.maxDescriptionLength} characters)`)
  );

const criterion = z.object({
  description: z.string().trim().min(3, "Each success criterion needs a description").max(300),
  targetValue: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(40).nullable().optional(),
});

const suggestLimiter = limiter(60_000, 15, "Too many suggestion requests. Please wait a minute.");

router.post(
  "/suggest",
  suggestLimiter,
  ah<OrgRequest>(async (req, res) => {
    const body = parse(z.object({ statement }), req.body);
    const ctx = await getCompanyContext(req.org!.orgId);
    res.json({ suggestion: await suggestForStatement(body.statement, formatCompanyProfile(ctx)) });
  })
);

const createSchema = z.object({
  statement,
  title: z.string().trim().max(140).optional(),
  successCriteria: z.array(criterion).max(6, "At most 6 success criteria").optional(),
  deadline: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .nullable()
    .optional(),
  budgetCents: z.number().int().min(MIN_BUDGET_CENTS, `The minimum budget is €${MIN_BUDGET_CENTS / 100}`).max(MAX_BUDGET_CENTS, `The maximum budget is €${MAX_BUDGET_CENTS / 100}`).optional(),
  contextNotes: z.string().max(8000).optional(),
  autonomy: z.enum(["REVIEW_PLAN", "AUTO_WITHIN_BUDGET"]).optional(),
  draft: z.boolean().optional(),
});

router.post(
  "/",
  taskRunLimiter,
  ah<OrgRequest>(async (req, res) => {
    const body = parse(createSchema, req.body);
    const created = await createObjective(req.org!, {
      ...body,
      contextNotes: body.contextNotes ? cleanText(body.contextNotes) : undefined,
      deadline: body.deadline ? new Date(body.deadline.length === 10 ? `${body.deadline}T23:59:59Z` : body.deadline) : null,
    });
    const objective = await prisma.objective.findUniqueOrThrow({
      where: { id: created.objectiveId },
      include: { criteria: true, createdBy: { select: { id: true, name: true } }, executions: { include: { steps: true } } },
    });
    res.status(201).json({ objective: toPublicObjective(objective), executionId: created.executionId });
  })
);

const GROUPS: Record<string, ObjectiveStatus[]> = {
  active: ["PLANNING", "PLANNED", "WAITING_FOR_APPROVAL", "RUNNING", "BLOCKED", "VERIFYING"],
  attention: ["WAITING_FOR_APPROVAL", "BLOCKED"],
  completed: ["COMPLETED"],
  drafts: ["DRAFT"],
  closed: ["FAILED", "CANCELLED"],
};

const listSchema = z.object({
  group: z.enum(["all", "active", "attention", "completed", "drafts", "closed"]).default("all"),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  q: z.string().trim().max(200).optional(),
});

router.get(
  "/",
  ah<OrgRequest>(async (req, res) => {
    const { group, cursor, limit, q } = parse(listSchema, req.query);
    const where: Prisma.ObjectiveWhereInput = {
      orgId: req.org!.orgId,
      ...(group !== "all" ? { status: { in: GROUPS[group] } } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { statement: { contains: q, mode: "insensitive" } }] } : {}),
    };
    const rows = await prisma.objective.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        criteria: true,
        createdBy: { select: { id: true, name: true } },
        executions: {
          orderBy: { attempt: "desc" },
          take: 1,
          include: { steps: { select: { status: true, title: true, agent: true, executive: true, order: true, kind: true } } },
        },
      },
    });
    const page = rows.slice(0, limit);
    const counts = await prisma.objective.groupBy({ by: ["status"], where: { orgId: req.org!.orgId }, _count: { _all: true } });
    const tally = (sts: ObjectiveStatus[]) => counts.filter((c) => sts.includes(c.status)).reduce((n, c) => n + c._count._all, 0);
    res.json({
      objectives: page.map(toPublicObjective),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      counts: {
        all: counts.reduce((n, c) => n + c._count._all, 0),
        active: tally(GROUPS.active),
        attention: tally(GROUPS.attention),
        completed: tally(GROUPS.completed),
        drafts: tally(GROUPS.drafts),
        closed: tally(GROUPS.closed),
      },
    });
  })
);

export async function loadObjectiveDetail(orgId: string, objectiveId: string) {
  const objective = await prisma.objective.findFirst({
    where: { id: objectiveId, orgId },
    include: {
      criteria: true,
      createdBy: { select: { id: true, name: true } },
      executions: { orderBy: { attempt: "desc" }, include: { steps: { select: { status: true, title: true, agent: true, executive: true, order: true, kind: true } } } },
    },
  });
  if (!objective) throw new HttpError(404, "Objective not found");
  const latest = objective.executions[0]
    ? ((await prisma.execution.findUnique({ where: { id: objective.executions[0].id }, include: FULL_EXECUTION_INCLUDE })) as FullExecution | null)
    : null;
  return {
    objective: toPublicObjective(objective),
    executions: objective.executions.map(toExecutionSummary),
    execution: latest ? toPublicExecution(latest) : null,
  };
}

router.get(
  "/:id",
  ah<OrgRequest>(async (req, res) => {
    res.json(await loadObjectiveDetail(req.org!.orgId, req.params.id));
  })
);

router.post(
  "/:id/plan",
  taskRunLimiter,
  ah<OrgRequest>(async (req, res) => {
    const executionId = await planDraft(req.org!, req.params.id);
    res.status(201).json({ executionId, ...(await loadObjectiveDetail(req.org!.orgId, req.params.id)) });
  })
);

router.post(
  "/:id/executions",
  taskRunLimiter,
  ah<OrgRequest>(async (req, res) => {
    const executionId = await newAttempt(req.org!, req.params.id);
    res.status(201).json({ executionId, ...(await loadObjectiveDetail(req.org!.orgId, req.params.id)) });
  })
);

router.put(
  "/:id/criteria",
  ah<OrgRequest>(async (req, res) => {
    const { criteria } = parse(z.object({ criteria: z.array(criterion).min(1).max(6) }), req.body);
    await replaceCriteria(req.org!, req.params.id, criteria);
    res.json(await loadObjectiveDetail(req.org!.orgId, req.params.id));
  })
);

export default router;
