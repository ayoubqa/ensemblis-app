// Recurring objectives ("routines", stored as Workflow rows): each run creates
// a real Objective that the Chief of Staff plans, the AI Team executes and the
// verifier checks — the same path as an objective a person defines. Nothing is
// charged at creation: approvals and budgets apply exactly as usual.
//
// The scheduler runs inside the worker (engine maintenance). A run is claimed
// with a compare-and-set on nextRun, so two workers never start it twice.

import type { Workflow } from "@prisma/client";
import { prisma } from "../db";
import { log } from "../lib/log";
import { resolveOrg } from "../org/organization";
import { createObjective } from "../engine/objectives";

export type Frequency = "Weekly" | "Monthly" | "Quarterly";

export function nextRunFrom(from: Date, frequency: string): Date {
  const d = new Date(from);
  if (frequency === "Weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "Quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Creates (and hands to the Chief of Staff) this run's objective. */
export async function runWorkflow(workflow: Workflow): Promise<{ objectiveId: string; executionId: string | null }> {
  const org = await resolveOrg(workflow.userId);
  const date = new Date().toISOString().slice(0, 10);
  const created = await createObjective(org, {
    statement: workflow.basedOnText,
    title: `${workflow.name} — ${date}`.slice(0, 140),
    successCriteria: workflow.successCriteria.map((description) => ({ description })),
    budgetCents: workflow.budgetCents ?? undefined,
    autonomy: workflow.autonomy ?? undefined,
    workflowId: workflow.id,
  });
  const now = new Date();
  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { lastRun: now, runCount: { increment: 1 }, nextRun: nextRunFrom(now, workflow.frequency), lastObjectiveId: created.objectiveId },
  });
  return created;
}

let ticking = false;

/** One scheduler pass: run every active recurring objective whose nextRun has passed. */
export async function schedulerTick(now = new Date()): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  let started = 0;
  try {
    const unscheduled = await prisma.workflow.findMany({ where: { isActive: true, nextRun: null } });
    for (const w of unscheduled) {
      await prisma.workflow.update({ where: { id: w.id }, data: { nextRun: nextRunFrom(w.lastRun ?? w.createdAt, w.frequency) } });
    }
    const due = await prisma.workflow.findMany({ where: { isActive: true, nextRun: { lte: now } }, orderBy: { nextRun: "asc" }, take: 25 });
    for (const w of due) {
      const claimedNext = nextRunFrom(now, w.frequency);
      const claimed = await prisma.workflow.updateMany({ where: { id: w.id, isActive: true, nextRun: w.nextRun }, data: { nextRun: claimedNext } });
      if (claimed.count === 0) continue;
      try {
        const r = await runWorkflow(w);
        started++;
        log.info("scheduler.run", { workflowId: w.id, objectiveId: r.objectiveId });
      } catch (err) {
        // Not runnable right now (e.g. guest allowance, account gone): try again in a day, not every minute.
        await prisma.workflow
          .updateMany({ where: { id: w.id, nextRun: claimedNext }, data: { nextRun: new Date(now.getTime() + 24 * 3600_000) } })
          .catch(() => undefined);
        log.warn("scheduler.run_failed", { workflowId: w.id, error: err });
      }
    }
  } finally {
    ticking = false;
  }
  return started;
}
