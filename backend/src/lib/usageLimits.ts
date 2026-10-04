// Daily task caps — the "kill switch" that bounds the AI bill. Every task run
// (new task, retry, workflow run, scheduled run) creates exactly one
// TASK_CHARGE transaction, so we count those since midnight UTC.

import { prisma } from "../db";
import { config } from "../config";
import { HttpError } from "./http";

export class DailyLimitError extends HttpError {
  scope: "user" | "global";
  constructor(scope: "user" | "global", message: string) {
    super(429, message);
    this.scope = scope;
  }
}

function startOfTodayUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function resetsIn(now = new Date()): string {
  const next = startOfTodayUTC(now).getTime() + 24 * 3600_000;
  const mins = Math.max(1, Math.ceil((next - now.getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h ? `${h}h ` : ""}${m}m`;
}

/** Throws a 429 DailyLimitError if this user or the whole server is at today's cap. */
export async function assertDailyTaskQuota(userId: string): Promise<void> {
  const since = startOfTodayUTC();
  const [globalCount, userCount] = await Promise.all([
    prisma.transaction.count({ where: { type: "TASK_CHARGE", createdAt: { gte: since } } }),
    prisma.transaction.count({ where: { type: "TASK_CHARGE", userId, createdAt: { gte: since } } }),
  ]);
  const when = `Limits reset at midnight UTC (in ${resetsIn()}).`;
  if (globalCount >= config.maxTasksPerDayGlobal) {
    throw new DailyLimitError(
      "global",
      `This demo has reached its daily limit of AI tasks across all users. Please come back tomorrow. ${when}`
    );
  }
  if (userCount >= config.maxTasksPerUserPerDay) {
    throw new DailyLimitError(
      "user",
      `You've reached today's limit of ${config.maxTasksPerUserPerDay} task${config.maxTasksPerUserPerDay === 1 ? "" : "s"} per account. ${when}`
    );
  }
}
