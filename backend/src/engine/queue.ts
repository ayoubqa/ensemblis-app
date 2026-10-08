// Durable job queue on Postgres (the existing database — no extra service).
//
//   enqueue  → INSERT, de-duplicated by `dedupeKey` (one live job per key)
//   claim    → UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED): safe
//              with any number of workers; a claimed job holds a lease
//   renew    → heartbeat extends the lease while the handler runs
//   complete → SUCCEEDED, dedupeKey released
//   fail     → back to QUEUED with exponential backoff, or DEAD after maxAttempts
//   reclaim  → jobs whose lease expired (worker crashed / was redeployed) are
//              re-queued — or declared DEAD when out of attempts
//
// Leases use the database clock (NOW()) so app-server clock skew can't matter.

import { Prisma, type Job } from "@prisma/client";
import { prisma } from "../db";

type Db = Prisma.TransactionClient | typeof prisma;

export interface EnqueueOptions {
  dedupeKey?: string;
  /** Run no earlier than this many ms from now. */
  delayMs?: number;
  maxAttempts?: number;
}

/**
 * Enqueues a job. With a dedupeKey, at most one QUEUED/RUNNING job exists per
 * key: a second enqueue is a no-op — except that a queued job is pulled
 * forward when the new request wants it sooner. Returns true when inserted.
 */
export async function enqueue(kind: string, payload: Prisma.InputJsonValue, opts: EnqueueOptions = {}, db: Db = prisma): Promise<boolean> {
  const runAt = new Date(Date.now() + Math.max(0, opts.delayMs ?? 0));
  const { count } = await db.job.createMany({
    data: [{ kind, payload, dedupeKey: opts.dedupeKey ?? null, runAt, maxAttempts: opts.maxAttempts ?? 5 }],
    skipDuplicates: true,
  });
  if (count === 0 && opts.dedupeKey) {
    await db.job.updateMany({ where: { dedupeKey: opts.dedupeKey, status: "QUEUED", runAt: { gt: runAt } }, data: { runAt } });
  }
  return count > 0;
}

/** Claims up to `limit` runnable jobs for `workerId`. `includeDelayed` (tests) ignores runAt. */
export async function claimJobs(workerId: string, limit: number, leaseMs: number, includeDelayed = false): Promise<Job[]> {
  if (limit <= 0) return [];
  const rows = await prisma.$queryRaw<Job[]>`
    UPDATE "Job"
       SET "status" = 'RUNNING'::"JobStatus",
           "lockedBy" = ${workerId},
           "lockedUntil" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
           "attempts" = "attempts" + 1,
           "updatedAt" = NOW()
     WHERE "id" IN (
       SELECT "id" FROM "Job"
        WHERE "status" = 'QUEUED'::"JobStatus" AND (${includeDelayed} OR "runAt" <= NOW())
        ORDER BY "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING *`;
  return rows;
}

// A claim is identified by (job id, worker id, attempts): `attempts` goes up on every claim, so a run
// whose lease expired and whose job was claimed again — even by the same worker — can't renew,
// complete or fail the newer claim.
type Claim = Pick<Job, "id" | "attempts">;

/** Extends the lease. False when the claim is no longer ours (reclaimed). */
export async function renewLease(job: Claim, workerId: string, leaseMs: number): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE "Job" SET "lockedUntil" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'), "updatedAt" = NOW()
     WHERE "id" = ${job.id} AND "lockedBy" = ${workerId} AND "attempts" = ${job.attempts} AND "status" = 'RUNNING'::"JobStatus"`;
  return n > 0;
}

/** False when the claim was lost meanwhile (nothing changed). */
export async function completeJob(job: Claim, workerId: string): Promise<boolean> {
  const r = await prisma.job.updateMany({
    where: { id: job.id, lockedBy: workerId, attempts: job.attempts, status: "RUNNING" },
    data: { status: "SUCCEEDED", dedupeKey: null, lockedBy: null, lockedUntil: null, completedAt: new Date() },
  });
  return r.count > 0;
}

/** Shutdown: hands this worker's unfinished claims back to the queue so another worker resumes them now. */
export async function releaseClaims(workerId: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Job" SET "status" = 'QUEUED'::"JobStatus", "lockedBy" = NULL, "lockedUntil" = NULL, "runAt" = NOW(),
           "lastError" = 'Worker shut down mid-job; re-queued', "updatedAt" = NOW()
     WHERE "lockedBy" = ${workerId} AND "status" = 'RUNNING'::"JobStatus"`;
}

export function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** Records a handler error. Returns "retry" (re-queued with backoff), "dead", or "lost" (the claim was no longer ours). */
export async function failJob(job: Job, workerId: string, error: string): Promise<"retry" | "dead" | "lost"> {
  const dead = job.attempts >= job.maxAttempts;
  const r = await prisma.job.updateMany({
    where: { id: job.id, lockedBy: workerId, attempts: job.attempts, status: "RUNNING" },
    data: dead
      ? { status: "DEAD", dedupeKey: null, lockedBy: null, lockedUntil: null, lastError: error.slice(0, 2000), completedAt: new Date() }
      : { status: "QUEUED", lockedBy: null, lockedUntil: null, lastError: error.slice(0, 2000), runAt: new Date(Date.now() + backoffMs(job.attempts)) },
  });
  if (r.count === 0) return "lost";
  return dead ? "dead" : "retry";
}

/** Re-queues jobs whose lease expired; returns the jobs declared DEAD (out of attempts). */
export async function reclaimExpired(): Promise<{ requeued: number; dead: Job[] }> {
  const dead = await prisma.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'DEAD'::"JobStatus", "dedupeKey" = NULL, "lockedBy" = NULL, "lockedUntil" = NULL,
           "lastError" = 'Lease expired after the last attempt (worker stopped mid-job)', "completedAt" = NOW(), "updatedAt" = NOW()
     WHERE "status" = 'RUNNING'::"JobStatus" AND "lockedUntil" < NOW() AND "attempts" >= "maxAttempts"
     RETURNING *`;
  const requeued = await prisma.$executeRaw`
    UPDATE "Job" SET "status" = 'QUEUED'::"JobStatus", "lockedBy" = NULL, "lockedUntil" = NULL, "runAt" = NOW(),
           "lastError" = 'Lease expired (worker stopped mid-job); re-queued', "updatedAt" = NOW()
     WHERE "status" = 'RUNNING'::"JobStatus" AND "lockedUntil" < NOW()`;
  return { requeued, dead };
}

/** Is there a live (queued or running) job for this key? */
export async function hasLiveJob(dedupeKey: string): Promise<boolean> {
  const j = await prisma.job.findUnique({ where: { dedupeKey }, select: { status: true } });
  return !!j && (j.status === "QUEUED" || j.status === "RUNNING");
}

export async function queueStats() {
  const [queued, running, dead, oldest] = await Promise.all([
    prisma.job.count({ where: { status: "QUEUED", runAt: { lte: new Date() } } }),
    prisma.job.count({ where: { status: "RUNNING" } }),
    prisma.job.count({ where: { status: "DEAD", completedAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    prisma.job.findFirst({ where: { status: "QUEUED", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, select: { runAt: true } }),
  ]);
  return {
    queued,
    running,
    deadLast24h: dead,
    oldestQueuedSeconds: oldest ? Math.max(0, Math.round((Date.now() - oldest.runAt.getTime()) / 1000)) : 0,
  };
}

/** Housekeeping: finished jobs older than `days` are deleted. */
export async function pruneJobs(days = 7): Promise<number> {
  const { count } = await prisma.job.deleteMany({
    where: { status: { in: ["SUCCEEDED", "DEAD"] }, completedAt: { lt: new Date(Date.now() - days * 24 * 3600_000) } },
  });
  return count;
}
