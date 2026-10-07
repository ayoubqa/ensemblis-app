// Daily task caps — the "kill switch" that bounds the AI bill. Every paid run
// (new task, retry, workflow run, scheduled run, follow-up) creates exactly one
// TASK_CHARGE transaction, so we count those since midnight UTC. Free developer
// test runs (Task.isTest) create no charge, so they are counted as tasks and
// only towards the server-wide cap.

import type { Prisma } from "@prisma/client";
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

export function startOfTodayUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function resetsIn(now = new Date()): string {
  const next = startOfTodayUTC(now).getTime() + 24 * 3600_000;
  const mins = Math.max(1, Math.ceil((next - now.getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h ? `${h}h ` : ""}${m}m`;
}

/**
 * Charges that count towards `userId`'s personal daily cap: runs they started
 * (actorUserId), whichever wallet paid — plus pre-v3 rows that have no actor
 * and were charged to their own wallet.
 */
export function userChargesWhere(userId: string, since: Date): Prisma.TransactionWhereInput {
  return {
    type: "TASK_CHARGE",
    createdAt: { gte: since },
    OR: [{ actorUserId: userId }, { actorUserId: null, userId }],
  };
}

/** AI runs started today across the whole server (paid runs + free test runs). */
export async function globalRunsToday(since = startOfTodayUTC()): Promise<number> {
  const [charges, testRuns] = await Promise.all([
    prisma.transaction.count({ where: { type: "TASK_CHARGE", createdAt: { gte: since } } }),
    prisma.task.count({ where: { isTest: true, createdAt: { gte: since } } }),
  ]);
  return charges + testRuns;
}

function globalLimitError(): DailyLimitError {
  return new DailyLimitError(
    "global",
    `This server has reached its daily limit of AI executions across all users. Please come back tomorrow. Limits reset at midnight UTC (in ${resetsIn()}).`
  );
}

/** Throws a 429 DailyLimitError if this user or the whole server is at today's cap. */
export async function assertDailyTaskQuota(userId: string): Promise<void> {
  const since = startOfTodayUTC();
  const [globalCount, userCount] = await Promise.all([
    globalRunsToday(since),
    prisma.transaction.count({ where: userChargesWhere(userId, since) }),
  ]);
  if (globalCount >= config.maxTasksPerDayGlobal) throw globalLimitError();
  if (userCount >= config.maxTasksPerUserPerDay) {
    throw new DailyLimitError(
      "user",
      `You've reached today's limit of ${config.maxTasksPerUserPerDay} task${config.maxTasksPerUserPerDay === 1 ? "" : "s"} per account. Limits reset at midnight UTC (in ${resetsIn()}).`
    );
  }
}

/** Server-wide cap only (developer test runs). */
export async function assertGlobalTaskQuota(): Promise<void> {
  if ((await globalRunsToday()) >= config.maxTasksPerDayGlobal) throw globalLimitError();
}

/**
 * Runs `fn` while holding an in-process lock for `key`, so check-then-create
 * sequences (e.g. "fewer than N today? then create") can't race with a
 * double-click. The API runs as a single instance, so this is sufficient.
 */
const locks = new Map<string, Promise<unknown>>();
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => (release = resolve));
  const chained = previous.then(() => current);
  locks.set(key, chained);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

/** Lock key shared by every path that starts an AI run (daily caps are checked under it). */
export const RUN_QUOTA_LOCK = "daily-run-quota";

/**
 * Checks today's caps and then runs `fn` (which must record the run: the
 * TASK_CHARGE or the isTest task) while holding one server-wide lock, so
 * parallel requests can't all pass the count before any of them is recorded.
 * Not re-entrant: never call it from inside `fn`.
 */
export function withRunQuota<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return withLock(RUN_QUOTA_LOCK, async () => {
    await assertDailyTaskQuota(userId);
    return fn();
  });
}

/**
 * Database-level version of the daily caps for code that runs in several
 * processes (API + worker): takes a transaction-scoped advisory lock so two
 * concurrent starts can't both pass the count, then checks the caps.
 * Call inside the transaction that records the charge.
 */
export async function assertDailyQuotaInTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${RUN_QUOTA_LOCK}))`;
  const since = startOfTodayUTC();
  const [charges, testRuns, userCount] = await Promise.all([
    tx.transaction.count({ where: { type: "TASK_CHARGE", createdAt: { gte: since } } }),
    tx.task.count({ where: { isTest: true, createdAt: { gte: since } } }),
    tx.transaction.count({ where: userChargesWhere(userId, since) }),
  ]);
  if (charges + testRuns >= config.maxTasksPerDayGlobal) throw globalLimitError();
  if (userCount >= config.maxTasksPerUserPerDay) {
    throw new DailyLimitError(
      "user",
      `You've reached today's limit of ${config.maxTasksPerUserPerDay} execution${config.maxTasksPerUserPerDay === 1 ? "" : "s"} per account. Limits reset at midnight UTC (in ${resetsIn()}).`
    );
  }
}
