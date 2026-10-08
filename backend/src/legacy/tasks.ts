// Legacy (v1–v3) task runs: the fixed 2–4 step pipeline that ran inside the
// API process. It no longer starts new work — objectives and executions
// replaced it (src/engine). What stays here protects existing data:
//
//   - failAndRefund / failRevision: refund exactly once (guarded status flip),
//     to the wallet that paid;
//   - sweepLegacyRuns: any legacy task or follow-up still RUNNING (e.g. one in
//     flight while this release was deployed) can never finish now, so it is
//     failed and refunded on the next maintenance pass.

import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { onTaskSettled } from "../lib/notify";
import { creditWallet } from "../lib/wallet";
import { log } from "../lib/log";

type Tx = Prisma.TransactionClient;

/**
 * Marks a task FAILED and refunds it exactly once (guarded by the status
 * transition, so concurrent failure paths can't double-refund). The refund
 * goes to the wallet that paid (Task.walletUserId; pre-v3 rows: the creator).
 */
export async function failAndRefund(taskId: string, message: string): Promise<boolean> {
  const settled = await prisma.$transaction(async (tx) => {
    const flipped = await tx.task.updateMany({
      where: { id: taskId, status: { in: ["RUNNING", "PLANNING"] } },
      data: { status: "FAILED", errorMessage: message.slice(0, 1000) },
    });
    if (flipped.count === 0) return false;
    // Read the price/wallet only AFTER the guarded flip (which locks the row).
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) return false;
    await tx.taskStep.updateMany({ where: { taskId, status: "RUNNING" }, data: { status: "FAILED", completedAt: new Date() } });
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
  if (settled) onTaskSettled(taskId).catch(() => undefined);
  return settled;
}

/** The wallet that paid for a follow-up: the matching charge transaction's wallet. */
async function chargedWallet(tx: Tx, rev: { taskId: string; costCents: number; createdAt: Date; requestedById: string | null }) {
  const windowMs = 5 * 60_000;
  const charges = await tx.transaction.findMany({
    where: {
      taskId: rev.taskId,
      type: "TASK_CHARGE",
      amountCents: -rev.costCents,
      description: { startsWith: "Follow-up:" },
      createdAt: { gte: new Date(rev.createdAt.getTime() - windowMs), lte: new Date(rev.createdAt.getTime() + windowMs) },
      ...(rev.requestedById ? { actorUserId: rev.requestedById } : {}),
    },
    select: { userId: true, createdAt: true },
  });
  if (!charges.length) return null;
  charges.sort((a, b) => Math.abs(a.createdAt.getTime() - rev.createdAt.getTime()) - Math.abs(b.createdAt.getTime() - rev.createdAt.getTime()));
  return charges[0].userId;
}

/** Marks a RUNNING follow-up FAILED and refunds its charge exactly once. */
export async function failRevision(revisionId: string, message: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rev = await tx.taskRevision.findUnique({ where: { id: revisionId }, include: { task: { select: { title: true, userId: true } } } });
    if (!rev) return;
    const flipped = await tx.taskRevision.updateMany({
      where: { id: revisionId, status: "RUNNING" },
      data: { status: "FAILED", errorMessage: message.slice(0, 1000), completedAt: new Date() },
    });
    if (flipped.count === 0 || rev.costCents <= 0) return;
    const candidates = [await chargedWallet(tx, rev), rev.requestedById, rev.task.userId].filter((x): x is string => !!x);
    for (const id of candidates) {
      if (await tx.user.findUnique({ where: { id }, select: { id: true } })) {
        await creditWallet(tx, {
          walletUserId: id,
          actorUserId: null,
          type: "REFUND",
          amountCents: rev.costCents,
          description: `Refund: Follow-up: ${rev.task.title}`,
          taskId: rev.taskId,
        });
        return;
      }
    }
    log.error("legacy.revision_refund_no_wallet", { revisionId });
  });
}

const STOPPED =
  "This task was interrupted while Ensemblis moved to its new execution engine. Your credits were refunded — create an objective to run it again.";

/**
 * Same grace as v3's own orphan sweeper: during a deploy (or a rollback to
 * v3) an old v3 instance may still be finishing its runs, so only runs older
 * than this are treated as orphaned.
 */
export const LEGACY_GRACE_MS = 15 * 60_000;

/** Fails + refunds every legacy task / follow-up still RUNNING after the grace period (nothing can finish them any more). */
export async function sweepLegacyRuns(now = new Date()): Promise<number> {
  let n = 0;
  const cutoff = new Date(now.getTime() - LEGACY_GRACE_MS);
  const tasks = await prisma.task.findMany({
    where: { status: { in: ["RUNNING", "PLANNING"] }, OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }] },
    select: { id: true },
    take: 50,
  });
  for (const t of tasks) if (await failAndRefund(t.id, STOPPED).catch(() => false)) n++;
  const revs = await prisma.taskRevision.findMany({ where: { status: "RUNNING", createdAt: { lt: cutoff } }, select: { id: true }, take: 50 });
  for (const r of revs) {
    await failRevision(r.id, STOPPED).catch((err) => log.error("legacy.revision_sweep_failed", { revisionId: r.id, error: err }));
    n++;
  }
  if (n) log.info("legacy.runs_refunded", { count: n });
  return n;
}
