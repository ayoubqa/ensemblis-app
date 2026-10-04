// Task lifecycle: estimating, charging and creating a team run. Shared by
// POST /api/tasks, POST /api/tasks/:id/retry, POST /api/workflows/:id/run and
// the workflow scheduler, so every path charges and plans the same way.

import type { Agent, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/http";
import { assertDailyTaskQuota } from "../lib/usageLimits";
import { TASK_INCLUDE, toPublicAgent, toPublicTask, toPublicUser } from "../lib/serializers";
import { classifyTask, Classification, Depth } from "./classify";
import { runTaskTeam } from "./orchestrator";

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

export async function estimate(description: string, opts: { depth?: Depth; agentId?: string } = {}) {
  const agents = await prisma.agent.findMany({ where: { isLive: true }, orderBy: { createdAt: "asc" } });
  if (opts.agentId && !agents.some((a) => a.id === opts.agentId)) {
    // Allow resolving a slug too; 404 if it is not a live agent.
    const bySlug = agents.find((a) => a.slug === opts.agentId);
    if (!bySlug) throw new HttpError(404, "Agent not found or not live");
    opts = { ...opts, agentId: bySlug.id };
  }
  if (agents.length === 0) {
    throw new HttpError(503, "No agents are available yet. Run `npm run seed` in backend/ to load the catalog.");
  }
  return classifyTask<Agent>(description, agents, opts);
}

export function toPublicEstimate(c: Classification<Agent>) {
  return {
    title: c.title,
    category: c.category,
    depth: c.depth,
    leadAgent: toPublicAgent(c.leadAgent),
    alternatives: c.alternatives.map(toPublicAgent),
    team: c.team.map((s) => ({ agentId: s.agent.id, agentName: s.agent.name, role: s.role, title: s.title })),
    capabilities: c.capabilities,
    costCents: c.costCents,
    estMinutesLow: c.estMinutesLow,
    estMinutesHigh: c.estMinutesHigh,
    manualHoursEstimate: c.manualHoursEstimate,
  };
}

function stepsData(c: Classification<Agent>) {
  return c.team.map((s, i) => ({
    order: i,
    agentId: s.agent.id,
    agentName: s.agent.name,
    role: s.role,
    title: s.title,
  }));
}

/** Throws 402 inside a transaction if the user cannot afford `cost`, then debits. */
async function debit(tx: Prisma.TransactionClient, userId: string, cost: number) {
  // Conditional decrement: atomic even under concurrent requests.
  const res = await tx.user.updateMany({
    where: { id: userId, credits: { gte: cost } },
    data: { credits: { decrement: cost } },
  });
  if (res.count === 0) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
    if (!user) throw new HttpError(401, "Account no longer exists");
    throw new HttpError(
      402,
      `Insufficient credits: this task costs ${eur(cost)} and your balance is ${eur(user.credits)}. Top up in Billing to continue.`
    );
  }
}

export interface CreateTaskInput {
  description: string;
  title?: string;
  depth?: Depth;
  agentId?: string;
}

/**
 * Re-estimates server-side (never trusts a client price), charges credits and
 * creates the task + its queued steps in one transaction, then starts the
 * team run in the background.
 */
export async function createTaskForUser(userId: string, input: CreateTaskInput) {
  await assertDailyTaskQuota(userId);
  const plan = await estimate(input.description, { depth: input.depth, agentId: input.agentId });
  const cost = plan.costCents;
  const title = input.title?.trim() || plan.title;

  const { taskId, user } = await prisma.$transaction(async (tx) => {
    await debit(tx, userId, cost);
    const task = await tx.task.create({
      data: {
        userId,
        agentId: plan.leadAgent.id,
        title,
        description: input.description,
        category: plan.category,
        depth: plan.depth,
        costCents: cost,
        status: "RUNNING",
        startedAt: new Date(),
        steps: { create: stepsData(plan) },
      },
    });
    await tx.transaction.create({
      data: {
        userId,
        type: "TASK_CHARGE",
        amountCents: -cost,
        description: `Task: ${title}`,
        taskId: task.id,
      },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    return { taskId: task.id, user };
  });

  startRun(taskId);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
  return { task: toPublicTask(task), user: toPublicUser(user) };
}

/** Re-runs a FAILED task with a fresh team; charges its price again. */
export async function retryTaskForUser(userId: string, taskId: string) {
  const existing = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!existing) throw new HttpError(404, "Task not found");
  if (existing.status !== "FAILED") {
    throw new HttpError(409, `Only failed tasks can be retried (this task is ${existing.status.toLowerCase()})`);
  }
  await assertDailyTaskQuota(userId);

  // Keep the original lead agent if it is still live; otherwise re-route.
  const leadLive = existing.agentId
    ? await prisma.agent.findFirst({ where: { id: existing.agentId, isLive: true }, select: { id: true } })
    : null;
  const depth = (["focused", "standard", "deep"] as const).find((d) => d === existing.depth) ?? "standard";
  const plan = await estimate(existing.description, { depth, agentId: leadLive?.id });
  const cost = existing.costCents > 0 ? existing.costCents : plan.costCents;

  const user = await prisma.$transaction(async (tx) => {
    // Guard against a double-click retry racing itself.
    const flipped = await tx.task.updateMany({
      where: { id: taskId, status: "FAILED" },
      data: {
        status: "RUNNING",
        agentId: plan.leadAgent.id,
        category: plan.category,
        costCents: cost,
        result: null,
        errorMessage: null,
        outcome: null,
        startedAt: new Date(),
        completedAt: null,
      },
    });
    if (flipped.count === 0) throw new HttpError(409, "This task is already being retried");
    await debit(tx, userId, cost);
    await tx.taskStep.deleteMany({ where: { taskId } });
    await tx.taskStep.createMany({ data: stepsData(plan).map((s) => ({ ...s, taskId })) });
    await tx.transaction.create({
      data: { userId, type: "TASK_CHARGE", amountCents: -cost, description: `Retry: ${existing.title}`, taskId },
    });
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });

  startRun(taskId);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
  return { task: toPublicTask(task), user: toPublicUser(user) };
}

// Fire-and-forget: don't make the HTTP caller wait minutes for the result.
function startRun(taskId: string) {
  runTaskTeam(taskId).catch((err) => console.error(`runTaskTeam(${taskId}) crashed:`, err));
}

/**
 * Marks a task FAILED and refunds it exactly once (guarded by the status
 * transition, so concurrent failure paths can't double-refund).
 */
export async function failAndRefund(taskId: string, message: string) {
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) return;
    const flipped = await tx.task.updateMany({
      where: { id: taskId, status: { in: ["RUNNING", "PLANNING"] } },
      data: { status: "FAILED", errorMessage: message.slice(0, 1000) },
    });
    if (flipped.count === 0) return;
    const now = new Date();
    await tx.taskStep.updateMany({
      where: { taskId, status: "RUNNING" },
      data: { status: "FAILED", completedAt: now },
    });
    if (task.costCents > 0) {
      await tx.user.update({ where: { id: task.userId }, data: { credits: { increment: task.costCents } } });
      await tx.transaction.create({
        data: {
          userId: task.userId,
          type: "REFUND",
          amountCents: task.costCents,
          description: `Refund: ${task.title}`,
          taskId,
        },
      });
    }
  });
}

/**
 * Called once on startup: any task still RUNNING/PLANNING was interrupted by
 * a server restart (runs are in-process), so fail and refund it rather than
 * leaving it spinning forever.
 */
export async function recoverInterruptedTasks() {
  const stuck = await prisma.task.findMany({
    where: { status: { in: ["RUNNING", "PLANNING"] } },
    select: { id: true },
  });
  for (const t of stuck) {
    await failAndRefund(t.id, "The server restarted while this task was running. Your credits were refunded — retry to run it again.");
  }
  if (stuck.length) console.log(`Recovered ${stuck.length} interrupted task(s) (failed + refunded).`);
}
