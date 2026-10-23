// Periodic housekeeping, run by the worker (never by more than the processes
// that run a worker): recovery sweep, recurring objectives, legacy run
// refunds, expired guest trials, unused legacy attachments, old jobs.

import { log } from "../lib/log";
import { cleanupExpiredGuests } from "../guest/cleanup";
import { cleanupOrphanAttachments } from "../attachments/cleanup";
import { sweepLegacyRuns } from "../legacy/tasks";
import { schedulerTick } from "../workflows/schedule";
import { pruneJobs } from "./queue";
import { recoverExecutions } from "./recovery";

let running = false;
let lastHourly = 0;

export async function maintenance(): Promise<void> {
  if (running) return;
  running = true;
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      log.error("maintenance.step_failed", { step: name, error: err });
    }
  };
  try {
    await step("recovery", () => recoverExecutions());
    if (process.env.DISABLE_SCHEDULER !== "true") await step("scheduler", () => schedulerTick());
    await step("legacy", () => sweepLegacyRuns());
    if (Date.now() - lastHourly > 3600_000) {
      lastHourly = Date.now();
      await step("guests", () => cleanupExpiredGuests());
      await step("attachments", () => cleanupOrphanAttachments());
      await step("jobs", () => pruneJobs());
    }
  } finally {
    running = false;
  }
}
