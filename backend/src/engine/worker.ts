// The worker: claims jobs from the Postgres queue and runs them.
//
// Runs either as its own process (`npm run worker` — the recommended
// deployment, see render.yaml) or embedded in the API process
// (EMBEDDED_WORKER=true) for single-service setups. Both are safe at the same
// time: claiming uses FOR UPDATE SKIP LOCKED and one live job per execution.
//
//   - bounded concurrency (WORKER_CONCURRENCY) on top of the per-process LLM limiter;
//   - each claimed job holds a lease renewed by a heartbeat; if the process
//     dies, the lease expires and another worker re-claims the job;
//   - a handler error re-queues the job with backoff; out of attempts it is
//     DEAD and the execution is failed and refunded (never left RUNNING);
//   - every LEASE/4 the recovery sweep runs (orphans, stalls, expiries);
//   - SIGTERM: stop claiming, let running jobs finish (up to a grace period).

import { randomBytes } from "node:crypto";
import os from "node:os";
import type { Job } from "@prisma/client";
import { prisma } from "../db";
import { log } from "../lib/log";
import { EXEC_TICK, RUNNABLE, enqueueTick, failExecution } from "./lifecycle";
import { executionTick, type TickResult } from "./machine";
import { claimJobs, completeJob, failJob, renewLease } from "./queue";

export const LEASE_MS = Number(process.env.WORKER_LEASE_MS) || 120_000;

export type JobHandler = (job: Job) => Promise<TickResult | void>;

export const HANDLERS: Record<string, JobHandler> = {
  [EXEC_TICK]: (job) => executionTick(String((job.payload as { executionId?: string }).executionId)),
};

/** After a job settles: keep a runnable execution moving (the dedupe key is free again). */
async function afterExecutionJob(job: Job, result: TickResult | void) {
  const executionId = String((job.payload as { executionId?: string }).executionId ?? "");
  if (!executionId) return;
  const ex = await prisma.execution.findUnique({ where: { id: executionId }, select: { status: true } });
  if (ex && RUNNABLE.includes(ex.status)) await enqueueTick(executionId, result?.nextRunInMs ?? 0);
}

/** A job that can never succeed: fail its execution (with refund) instead of leaving it stuck. */
export async function onDeadJob(job: Job): Promise<void> {
  if (job.kind !== EXEC_TICK) return;
  const executionId = String((job.payload as { executionId?: string }).executionId ?? "");
  if (!executionId) return;
  await failExecution(
    executionId,
    `Ensemblis couldn't keep this execution running (${job.attempts} attempts). ${job.lastError ? `Last error: ${job.lastError.slice(0, 300)}` : ""}`.trim()
  ).catch((err) => log.error("worker.dead_job_fail_failed", { jobId: job.id, executionId, error: err }));
}

export interface WorkerOptions {
  concurrency?: number;
  pollMs?: number;
  /** Periodic maintenance (recovery sweep, scheduler…), run every `maintenanceMs`. */
  maintenance?: () => Promise<void>;
  maintenanceMs?: number;
}

export class Worker {
  readonly id = `${os.hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
  private active = new Map<string, Promise<void>>();
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;
  private lastMaintenance = 0;
  private readonly concurrency: number;
  private readonly pollMs: number;

  constructor(private readonly opts: WorkerOptions = {}) {
    this.concurrency = Math.max(1, opts.concurrency ?? (Number(process.env.WORKER_CONCURRENCY) || 2));
    this.pollMs = opts.pollMs ?? (Number(process.env.WORKER_POLL_MS) || 1000);
  }

  start(): void {
    log.info("worker.started", { workerId: this.id, concurrency: this.concurrency });
    const loop = async () => {
      if (this.stopping) return;
      try {
        await this.poll();
      } catch (err) {
        log.error("worker.poll_failed", { workerId: this.id, error: err });
      }
      if (!this.stopping) this.timer = setTimeout(loop, this.pollMs);
    };
    this.timer = setTimeout(loop, 250);
  }

  async stop(graceMs = 25_000): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    const all = Promise.allSettled([...this.active.values()]);
    await Promise.race([all, new Promise((r) => setTimeout(r, graceMs))]);
    log.info("worker.stopped", { workerId: this.id, unfinished: this.active.size });
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    if (this.opts.maintenance && now - this.lastMaintenance >= (this.opts.maintenanceMs ?? 30_000)) {
      this.lastMaintenance = now;
      await this.opts.maintenance().catch((err) => log.error("worker.maintenance_failed", { error: err }));
    }
    const free = this.concurrency - this.active.size;
    if (free <= 0) return;
    const jobs = await claimJobs(this.id, free, LEASE_MS);
    for (const job of jobs) {
      const p = this.run(job).finally(() => this.active.delete(job.id));
      this.active.set(job.id, p);
    }
  }

  /** Runs one claimed job to completion (exported behaviour for tests via drain()). */
  async run(job: Job): Promise<void> {
    const handler = HANDLERS[job.kind];
    const heartbeat = setInterval(() => {
      renewLease(job.id, this.id, LEASE_MS).catch(() => undefined);
    }, Math.max(1000, Math.floor(LEASE_MS / 4)));
    const started = Date.now();
    try {
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      const result = await handler(job);
      await completeJob(job.id, this.id);
      if (job.kind === EXEC_TICK) await afterExecutionJob(job, result);
      log.debug("worker.job_done", { jobId: job.id, kind: job.kind, ms: Date.now() - started });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await failJob(job, this.id, message).catch(() => "retry" as const);
      const executionId = job.kind === EXEC_TICK ? String((job.payload as { executionId?: string })?.executionId ?? "") || undefined : undefined;
      log.warn("worker.job_failed", { jobId: job.id, kind: job.kind, executionId, attempt: job.attempts, outcome, error: message.slice(0, 300) });
      if (outcome === "dead") await onDeadJob({ ...job, lastError: message });
    } finally {
      clearInterval(heartbeat);
    }
  }
}

/**
 * Test / ops helper: runs queued jobs in this process until none are left
 * (or `maxJobs`). `includeDelayed` also runs jobs scheduled in the future.
 */
export async function drain(opts: { maxJobs?: number; includeDelayed?: boolean } = {}): Promise<number> {
  const w = new Worker({ concurrency: 1 });
  let n = 0;
  const max = opts.maxJobs ?? 200;
  while (n < max) {
    const [job] = await claimJobs(w.id, 1, LEASE_MS, !!opts.includeDelayed);
    if (!job) break;
    await w.run(job);
    n++;
  }
  return n;
}
