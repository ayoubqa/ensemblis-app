// Recovery: no execution may stay stuck. Run by the worker every ~30s.
//
//   1. Expired job leases (a worker died mid-job) are re-queued; jobs out of
//      attempts are DEAD and their execution is failed + refunded.
//   2. Orphans: an execution in a runnable state (PLANNING / PLANNED /
//      RUNNING / VERIFYING) with no live job gets one (covers lost enqueues).
//   3. Stalls: a runnable execution with no progress for STALL_MS is failed
//      and refunded (a last resort; individual model calls time out much sooner).
//   4. Waits that nobody answers: WAITING_FOR_APPROVAL / BLOCKED for
//      WAIT_EXPIRY_MS are cancelled (the unrun work is refunded).

import { prisma } from "../db";
import { log } from "../lib/log";
import { cancelExecution, enqueueTick, execKey, failExecution, RUNNABLE } from "./lifecycle";
import { hasLiveJob, reclaimExpired } from "./queue";
import { onDeadJob } from "./worker";

export const ORPHAN_AFTER_MS = 90_000;
export const STALL_MS = Number(process.env.EXECUTION_STALL_MS) || 45 * 60_000;
export const WAIT_EXPIRY_MS = Number(process.env.EXECUTION_WAIT_EXPIRY_MS) || 14 * 24 * 3600_000;

export async function recoverExecutions(now = new Date()): Promise<{ requeued: number; dead: number; orphans: number; stalled: number; expired: number }> {
  const { requeued, dead } = await reclaimExpired();
  for (const job of dead) await onDeadJob(job);

  let orphans = 0;
  const quiet = await prisma.execution.findMany({
    where: { status: { in: RUNNABLE }, lastProgressAt: { lt: new Date(now.getTime() - ORPHAN_AFTER_MS) } },
    select: { id: true, lastProgressAt: true },
    take: 100,
  });
  let stalled = 0;
  const touched: { orphans: string[]; stalled: string[]; expired: string[] } = { orphans: [], stalled: [], expired: [] };
  for (const ex of quiet) {
    if (ex.lastProgressAt.getTime() < now.getTime() - STALL_MS) {
      if (await failExecution(ex.id, `The execution stopped making progress for ${Math.round(STALL_MS / 60_000)} minutes.`)) {
        stalled++;
        touched.stalled.push(ex.id);
      }
      continue;
    }
    if (!(await hasLiveJob(execKey(ex.id)))) {
      await enqueueTick(ex.id);
      orphans++;
      touched.orphans.push(ex.id);
    }
  }

  let expired = 0;
  const waiting = await prisma.execution.findMany({
    where: { status: { in: ["WAITING_FOR_APPROVAL", "BLOCKED"] }, lastProgressAt: { lt: new Date(now.getTime() - WAIT_EXPIRY_MS) } },
    select: { id: true },
    take: 50,
  });
  for (const ex of waiting) {
    try {
      if (await cancelExecution(ex.id, { userId: null, reason: `No decision for ${Math.round(WAIT_EXPIRY_MS / 86_400_000)} days` })) {
        expired++;
        touched.expired.push(ex.id);
      }
    } catch {
      /* already settled */
    }
  }
  if (requeued || dead.length || orphans || stalled || expired) {
    log.info("recovery.sweep", { requeued, dead: dead.length, deadJobs: dead.map((j) => j.id), orphans, stalled, expired, executions: touched });
  }
  return { requeued, dead: dead.length, orphans, stalled, expired };
}
