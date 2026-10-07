// Workflow (recurring task) scheduling: next-run calculation, running a
// workflow now, and a lightweight in-process scheduler that runs due workflows.

import type { Workflow } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/http";
import { createTaskForUser, sweepOrphanedTasks } from "../tasks/service";
import { sweepOrphanedRevisions } from "../tasks/revisions";
import { DailyLimitError, startOfTodayUTC } from "../lib/usageLimits";
import { cleanupExpiredGuests } from "../guest/cleanup";
import { cleanupOrphanAttachments } from "../attachments/cleanup";

export type Frequency = "Weekly" | "Monthly" | "Quarterly";

export function nextRunFrom(from: Date, frequency: string): Date {
  const d = new Date(from);
  if (frequency === "Weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "Quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

const asDepth = (d: string) => (d === "focused" || d === "deep" ? d : "standard") as "focused" | "standard" | "deep";

/** Creates a real task from the workflow (same path as POST /api/tasks). */
export async function runWorkflow(workflow: Workflow) {
  let agentId = workflow.agentId ?? undefined;
  if (agentId) {
    const live = await prisma.agent.findFirst({ where: { id: agentId, isLive: true }, select: { id: true } });
    if (!live) agentId = undefined; // agent was unpublished: let routing pick a new lead
  }
  const result = await createTaskForUser(workflow.userId, {
    description: workflow.basedOnText,
    title: workflow.name,
    depth: asDepth(workflow.depth),
    agentId,
  });
  const now = new Date();
  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { lastRun: now, runCount: { increment: 1 }, nextRun: nextRunFrom(now, workflow.frequency) },
  });
  return result;
}

let ticking = false;

/** One scheduler pass: run every active workflow whose nextRun has passed. */
export async function schedulerTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    // Legacy rows created before nextRun was always set.
    const unscheduled = await prisma.workflow.findMany({ where: { isActive: true, nextRun: null } });
    for (const w of unscheduled) {
      await prisma.workflow.update({ where: { id: w.id }, data: { nextRun: nextRunFrom(w.lastRun ?? w.createdAt, w.frequency) } });
    }

    const due = await prisma.workflow.findMany({
      where: { isActive: true, nextRun: { lte: now } },
      orderBy: { nextRun: "asc" },
      take: 25,
    });
    for (const w of due) {
      // Claim this run atomically before charging anyone: during a deploy the
      // old and the new server both run this scheduler for a moment, and only
      // the one whose compare-and-set succeeds may start (and charge) the run.
      const claimedNext = nextRunFrom(now, w.frequency);
      const claimed = await prisma.workflow.updateMany({
        where: { id: w.id, isActive: true, nextRun: w.nextRun },
        data: { nextRun: claimedNext },
      });
      if (claimed.count === 0) continue; // another tick/instance took it, or it was paused/edited
      // Un-claims the run: the skipped run is not lost, it is retried at `retryAt`.
      const release = (retryAt: Date | null) =>
        prisma.workflow
          .updateMany({ where: { id: w.id, nextRun: claimedNext }, data: { nextRun: retryAt } })
          .catch(() => undefined);
      try {
        const { task } = await runWorkflow(w);
        console.log(`Scheduler: ran workflow "${w.name}" (${w.id}) -> task ${task.id}`);
      } catch (err) {
        if (err instanceof DailyLimitError) {
          // Daily cap reached: skip quietly. A global cap stops this whole pass
          // (nextRun restored: it runs once the cap resets). A user's own cap
          // retries after midnight UTC — never at its old due time, which would
          // keep it at the head of the queue (take: 25) and starve every other
          // user's workflows all day.
          await release(err.scope === "global" ? w.nextRun : new Date(startOfTodayUTC(now).getTime() + 24 * 3600_000));
          console.log(`Scheduler: skipped workflow ${w.id} — daily ${err.scope} task limit reached`);
          if (err.scope === "global") break;
          continue;
        }
        if (err instanceof HttpError && err.status === 402) {
          // Not enough credits: retry in an hour (so it runs soon after a
          // top-up), not at its old due time — 25 unaffordable workflows would
          // otherwise block the scheduler for everyone until their owner tops up.
          await release(new Date(now.getTime() + 60 * 60_000));
          continue;
        }
        console.error(`Scheduler: workflow ${w.id} failed to start:`, err);
        // Avoid retrying a broken workflow every minute.
        await prisma.workflow
          .update({ where: { id: w.id }, data: { nextRun: nextRunFrom(now, w.frequency) } })
          .catch(() => undefined);
      }
    }
  } finally {
    ticking = false;
  }
}

let maintaining = false;

/** Housekeeping on every tick (cheap when idle): expired guest trials, orphan attachments. */
export async function maintenanceTick() {
  if (maintaining) return;
  maintaining = true;
  try {
    await cleanupExpiredGuests().catch((err) => console.error("Guest cleanup failed:", err));
    await cleanupOrphanAttachments().catch((err) => console.error("Attachment cleanup failed:", err));
    // Runs stuck RUNNING with no live run behind them: fail + refund (money is never held indefinitely).
    await sweepOrphanedTasks().catch((err) => console.error("Orphaned task sweep failed:", err));
    await sweepOrphanedRevisions().catch((err) => console.error("Orphaned follow-up sweep failed:", err));
  } finally {
    maintaining = false;
  }
}

export function startScheduler(intervalMs = 60_000) {
  const tick = async () => {
    await schedulerTick().catch((err) => console.error("Scheduler tick failed:", err));
    await maintenanceTick().catch((err) => console.error("Maintenance tick failed:", err));
  };
  setTimeout(tick, 5_000); // shortly after boot
  return setInterval(tick, intervalMs);
}

