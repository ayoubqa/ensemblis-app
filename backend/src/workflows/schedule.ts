// Workflow (recurring task) scheduling: next-run calculation, running a
// workflow now, and a lightweight in-process scheduler that runs due workflows.

import type { Workflow } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/http";
import { createTaskForUser } from "../tasks/service";
import { DailyLimitError } from "../lib/usageLimits";

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
      try {
        const { task } = await runWorkflow(w);
        console.log(`Scheduler: ran workflow "${w.name}" (${w.id}) -> task ${task.id}`);
      } catch (err) {
        if (err instanceof DailyLimitError) {
          // Daily cap reached: skip quietly; nextRun is left as-is so it runs
          // once the cap resets. A global cap stops this whole pass.
          console.log(`Scheduler: skipped workflow ${w.id} — daily ${err.scope} task limit reached`);
          if (err.scope === "global") break;
          continue;
        }
        if (err instanceof HttpError && err.status === 402) {
          // Not enough credits: skip for now. nextRun is left as-is, so it runs
          // on the first tick after the user tops up.
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

export function startScheduler(intervalMs = 60_000) {
  const tick = () => schedulerTick().catch((err) => console.error("Scheduler tick failed:", err));
  setTimeout(tick, 5_000); // shortly after boot
  return setInterval(tick, intervalMs);
}

