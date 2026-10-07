// Task lifecycle: estimating, charging and creating a team run. Shared by
// POST /api/tasks, POST /api/tasks/:id/retry, POST /api/workflows/:id/run,
// the workflow scheduler and developer test runs, so every path charges and
// plans the same way.
//
// v3: credits move only through lib/wallet.ts. A team member's runs are paid
// from the team wallet (the owner's balance); Task.walletUserId remembers who
// paid so a refund always goes back to the same wallet.

import type { Agent, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError } from "../lib/http";
import { findAccessibleTask } from "../lib/access";
import { onTaskSettled } from "../lib/notify";
import { assertGlobalTaskQuota, resetsIn, RUN_QUOTA_LOCK, startOfTodayUTC, withLock, withRunQuota } from "../lib/usageLimits";
import { TASK_INCLUDE, asDepth, loadPublicUser, toPublicAgent, toPublicTask } from "../lib/serializers";
import { creditWallet, debitWallet, resolveWallet, spendableBalance } from "../lib/wallet";
import { classifyTask, Classification, Depth } from "./classify";
import { runTaskTeam } from "./orchestrator";

type Db = Prisma.TransactionClient | typeof prisma;

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

// ---------------------------------------------------------------- guests

/** Paid runs a user has ever started (guests: their lifetime trial runs). */
function lifetimeRuns(db: Db, userId: string) {
  return db.transaction.count({
    where: { type: "TASK_CHARGE", OR: [{ actorUserId: userId }, { actorUserId: null, userId }] },
  });
}

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/** Guests can't top up, so tell them plainly when a brief costs more than their trial balance. */
async function assertGuestCanAfford(userId: string, cost: number) {
  const { credits } = await spendableBalance(userId);
  if (credits < cost) {
    throw new HttpError(
      402,
      `This brief costs ${eur(cost)}, more than your ${eur(credits)} trial balance. Try a narrower brief or another agent — or create a free account to add credits.`
    );
  }
}

function guestLimitError() {
  const n = config.guest.maxTasks;
  return new HttpError(
    403,
    `Create a free account to run more tasks — the free trial includes ${n} task${n === 1 ? "" : "s"}. Everything from your trial is kept when you sign up.`
  );
}

async function loadRunner(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isGuest: true } });
  if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  return user;
}

// ---------------------------------------------------------------- create

export interface CreateTaskInput {
  description: string;
  title?: string;
  depth?: Depth;
  agentId?: string;
  attachmentIds?: string[];
}

/**
 * Re-estimates server-side (never trusts a client price), charges the right
 * wallet and creates the task + its queued steps (+ binds attachments) in one
 * transaction, then starts the team run in the background.
 */
export async function createTaskForUser(userId: string, input: CreateTaskInput) {
  const user = await loadRunner(userId);
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];

  if (user.isGuest) {
    if (attachmentIds.length) throw new HttpError(403, "Create a free account to attach files and links.");
    if ((await lifetimeRuns(prisma, userId)) >= config.guest.maxTasks) throw guestLimitError();
  }
  if (attachmentIds.length > config.attachments.maxPerTask) {
    throw new HttpError(
      400,
      config.attachments.maxPerTask === 0
        ? "Attachments are turned off on this server."
        : `You can attach at most ${config.attachments.maxPerTask} file${config.attachments.maxPerTask === 1 ? "" : "s"} or link${config.attachments.maxPerTask === 1 ? "" : "s"} per task.`
    );
  }

  // Daily caps are checked and the charge recorded under one lock (no double-click overshoot).
  const taskId = await withRunQuota(userId, async () => {
    // Guests always run the cheapest, quickest team.
    const plan = await estimate(input.description, {
      depth: user.isGuest ? "focused" : input.depth,
      agentId: input.agentId,
    });
    const cost = plan.costCents;
    const title = input.title?.trim() || plan.title;
    if (user.isGuest) await assertGuestCanAfford(userId, cost);

    return prisma.$transaction(async (tx) => {
      const wallet = await resolveWallet(userId, tx);
      const task = await tx.task.create({
        data: {
          userId,
          teamId: wallet.teamId,
          walletUserId: wallet.walletUserId,
          agentId: plan.leadAgent.id,
          title,
          description: input.description,
          category: plan.category,
          depth: user.isGuest ? "focused" : plan.depth,
          costCents: cost,
          status: "RUNNING",
          startedAt: new Date(),
          steps: { create: stepsData(plan) },
        },
      });
      // Throws 402 (rolling everything back) when the wallet can't afford it.
      await debitWallet(tx, { wallet, actorUserId: userId, amountCents: cost, description: `Task: ${title}`, taskId: task.id });

      // Re-check after the debit: the debit locked the guest's row, so a
      // concurrent second request waits here and then sees this charge.
      if (user.isGuest && (await lifetimeRuns(tx, userId)) > config.guest.maxTasks) throw guestLimitError();

      if (attachmentIds.length) {
        const bound = await tx.taskAttachment.updateMany({
          where: { id: { in: attachmentIds }, userId, taskId: null },
          data: { taskId: task.id },
        });
        if (bound.count !== attachmentIds.length) {
          throw new HttpError(
            400,
            "Some attachments can't be used (they were removed or already used for another task). Please attach them again."
          );
        }
      }
      return task.id;
    });
  });

  startRun(taskId);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
  return { task: toPublicTask(task), user: await loadPublicUser(userId) };
}

/** Re-runs a FAILED task (yours or your team's) with a fresh team; charges its price again. */
export async function retryTaskForUser(userId: string, taskId: string) {
  const existing = await findAccessibleTask(userId, taskId, {});
  if (existing.isTest) {
    throw new HttpError(409, "Test runs can't be retried. Start a new test run from your developer dashboard.");
  }
  if (existing.status !== "FAILED") {
    throw new HttpError(409, `Only failed tasks can be retried (this task is ${existing.status.toLowerCase()})`);
  }
  const user = await loadRunner(userId);
  if (user.isGuest && (await lifetimeRuns(prisma, userId)) >= config.guest.maxTasks) throw guestLimitError();

  // Daily caps are checked and the charge recorded under one lock (no double-click overshoot).
  await withRunQuota(userId, async () => {
    // Keep the original lead agent if it is still live; otherwise re-route.
    const leadLive = existing.agentId
      ? await prisma.agent.findFirst({ where: { id: existing.agentId, isLive: true }, select: { id: true } })
      : null;
    const depth: Depth = user.isGuest ? "focused" : asDepth(existing.depth);
    const plan = await estimate(existing.description, { depth, agentId: leadLive?.id });
    const cost = existing.costCents > 0 ? existing.costCents : plan.costCents;
    if (user.isGuest) await assertGuestCanAfford(userId, cost);

    await prisma.$transaction(async (tx) => {
      const wallet = await resolveWallet(userId, tx);
      // Guard against a double-click retry racing itself.
      const flipped = await tx.task.updateMany({
        where: { id: taskId, status: "FAILED" },
        data: {
          status: "RUNNING",
          agentId: plan.leadAgent.id,
          category: plan.category,
          depth,
          costCents: cost,
          result: null,
          errorMessage: null,
          outcome: null,
          startedAt: new Date(),
          completedAt: null,
          // Whoever pays for this run owns the refund; the task stays visible to that wallet's team.
          teamId: wallet.teamId,
          walletUserId: wallet.walletUserId,
        },
      });
      if (flipped.count === 0) throw new HttpError(409, "This task is already being retried");
      await debitWallet(tx, { wallet, actorUserId: userId, amountCents: cost, description: `Retry: ${existing.title}`, taskId });
      if (user.isGuest && (await lifetimeRuns(tx, userId)) > config.guest.maxTasks) throw guestLimitError();
      // A fresh run: new steps and freshly collected sources.
      await tx.taskStep.deleteMany({ where: { taskId } });
      await tx.taskSource.deleteMany({ where: { taskId } });
      await tx.taskStep.createMany({ data: stepsData(plan).map((s) => ({ ...s, taskId })) });
    });
  });

  startRun(taskId);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
  return { task: toPublicTask(task), user: await loadPublicUser(userId) };
}

// ---------------------------------------------------------------- developer test runs

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…");

/**
 * A free single-agent run of the developer's own agent (v3): isTest, cost 0,
 * focused, one "Analysis" step, no charge. Limited per developer per UTC day
 * and counted towards the server-wide daily cap.
 */
export async function createTestRun(userId: string, agentIdOrSlug: string, description: string) {
  const agent = await prisma.agent.findFirst({
    where: { OR: [{ id: agentIdOrSlug }, { slug: agentIdOrSlug }], ownerId: userId },
  });
  if (!agent) throw new HttpError(404, "Agent not found — you can only test agents you published.");
  const perDay = config.devTestRunsPerDay;
  if (perDay <= 0) throw new HttpError(403, "Free test runs are turned off on this server.");

  // Same lock as paid runs, so the server-wide cap can't be overshot either.
  const taskId = await withLock(RUN_QUOTA_LOCK, async () => {
    const used = await prisma.task.count({ where: { userId, isTest: true, createdAt: { gte: startOfTodayUTC() } } });
    if (used >= perDay) {
      throw new HttpError(
        429,
        `You've used today's ${perDay} free test run${perDay === 1 ? "" : "s"}. They reset at midnight UTC (in ${resetsIn()}).`
      );
    }
    await assertGlobalTaskQuota();
    const firstLine = description.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "Test run";
    const task = await prisma.task.create({
      data: {
        userId,
        walletUserId: userId,
        teamId: null,
        isTest: true,
        agentId: agent.id,
        title: `Test run: ${clip(firstLine, 80)}`,
        description,
        category: agent.category,
        depth: "focused",
        costCents: 0,
        status: "RUNNING",
        startedAt: new Date(),
        steps: { create: [{ order: 0, agentId: agent.id, agentName: agent.name, role: "Analysis", title: "Test run" }] },
      },
    });
    return task.id;
  });

  startRun(taskId);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
  return toPublicTask(task);
}

// ---------------------------------------------------------------- running / failing

/** Task ids whose team run is in progress in THIS process (see sweepOrphanedTasks). */
const activeRuns = new Map<string, number>();

// Fire-and-forget: don't make the HTTP caller wait minutes for the result.
export function startRun(taskId: string) {
  activeRuns.set(taskId, (activeRuns.get(taskId) ?? 0) + 1);
  runTaskTeam(taskId)
    .catch((err) => console.error(`runTaskTeam(${taskId}) crashed:`, err))
    .finally(() => {
      const left = (activeRuns.get(taskId) ?? 1) - 1;
      if (left > 0) activeRuns.set(taskId, left);
      else activeRuns.delete(taskId);
    });
}

const ORPHAN_GRACE_MS = 15 * 60_000;

/**
 * Periodic safety net: a RUNNING task that no run in this process is working
 * on (its run crashed before it could fail itself, the refund write hit a
 * database error, or it was started by an instance that has since shut down
 * during a deploy) is failed and refunded once it is older than the grace period.
 */
export async function sweepOrphanedTasks(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_GRACE_MS);
  const stale = await prisma.task.findMany({
    where: {
      status: { in: ["RUNNING", "PLANNING"] },
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }],
    },
    select: { id: true },
    take: 50,
  });
  let swept = 0;
  for (const t of stale) {
    if (activeRuns.has(t.id)) continue;
    try {
      await failAndRefund(t.id, "This task stopped unexpectedly (the server restarted or lost its connection). Your credits were refunded — retry to run it again.");
      swept++;
    } catch (err) {
      console.error(`[sweeper] could not fail task ${t.id}:`, err instanceof Error ? err.message : err);
    }
  }
  if (swept) console.log(`[sweeper] failed + refunded ${swept} orphaned task(s).`);
  return swept;
}

/**
 * Marks a task FAILED and refunds it exactly once (guarded by the status
 * transition, so concurrent failure paths can't double-refund). The refund
 * goes to the wallet that paid (Task.walletUserId; pre-v3 rows: the creator).
 */
export async function failAndRefund(taskId: string, message: string) {
  const settled = await prisma.$transaction(async (tx) => {
    const flipped = await tx.task.updateMany({
      where: { id: taskId, status: { in: ["RUNNING", "PLANNING"] } },
      data: { status: "FAILED", errorMessage: message.slice(0, 1000) },
    });
    if (flipped.count === 0) return false;
    // Read the price/wallet only AFTER the guarded flip (which locks the row), so
    // the refund always matches the run that was just failed — never a stale
    // copy from before a concurrent fail + retry re-priced or re-walleted it.
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) return false;
    await tx.taskStep.updateMany({
      where: { taskId, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date() },
    });
    if (task.costCents > 0 && !task.isTest) {
      let walletUserId = task.walletUserId ?? task.userId;
      if (walletUserId !== task.userId) {
        const exists = await tx.user.findUnique({ where: { id: walletUserId }, select: { id: true } });
        if (!exists) walletUserId = task.userId;
      }
      await creditWallet(tx, {
        walletUserId,
        actorUserId: null,
        type: "REFUND",
        amountCents: task.costCents,
        description: `Refund: ${task.title}`,
        taskId,
      });
    }
    return true;
  });
  // Not awaited: an email must never delay a request or startup recovery.
  if (settled) onTaskSettled(taskId).catch(() => undefined);
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
