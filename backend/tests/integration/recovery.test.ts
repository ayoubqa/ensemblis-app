// Durability: executions survive worker crashes, lost jobs and browser
// reconnects; nothing can stay RUNNING forever.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { app } from "../../src/index";
import { claimJobs } from "../../src/engine/queue";
import { execKey } from "../../src/engine/lifecycle";
import { recoverExecutions, STALL_MS } from "../../src/engine/recovery";
import { api, approvePending, balance, createUser, defineObjective, fillContext, getExecution, runWorker } from "../helpers";

async function startedExecution() {
  const { auth, user } = await createUser({ credits: 5000 });
  await fillContext(auth);
  const { executionId, objectiveId } = await defineObjective(auth);
  await runWorker();
  await approvePending(auth);
  return { auth, user, executionId, objectiveId };
}

describe("crash recovery", () => {
  it("resumes after a worker dies mid-step: the lease expires, the job is re-claimed, the step re-runs, nothing is charged twice", async () => {
    const { auth, user, executionId } = await startedExecution();
    const charged = await balance(user.id);

    // Run the first step normally, then simulate a worker that claimed the next tick and died mid-step.
    await runWorker(1);
    const [job] = await claimJobs("dead-worker", 1, 60_000, true);
    expect(job.dedupeKey).toBe(execKey(executionId));
    const next = await prisma.executionStep.findFirstOrThrow({ where: { executionId, status: "PENDING" }, orderBy: { order: "asc" } });
    await prisma.executionStep.update({ where: { id: next.id }, data: { status: "RUNNING", attempts: 1, startedAt: new Date(), partialOutput: "half-written…" } });
    await prisma.job.update({ where: { id: job.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });

    // A browser refreshing now still gets a coherent, persisted picture.
    const mid = await getExecution(auth, executionId);
    expect(mid.status).toBe("RUNNING");
    expect(mid.steps.find((s: { id: string }) => s.id === next.id).partialOutput).toBe("half-written…");

    const r = await recoverExecutions();
    expect(r.requeued).toBe(1);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    const rerun = ex.steps.find((s: { id: string }) => s.id === next.id);
    expect(rerun.attempts).toBe(2);
    expect(rerun.partialOutput).toBeNull();
    expect(ex.events.some((e: { type: string; message: string }) => e.type === "EXECUTION_RESUMED" && /interruption/.test(e.message))).toBe(true);
    expect(await balance(user.id)).toBe(charged);
  });

  it("a stale write from the crashed worker can't overwrite the re-run (fencing on attempts)", async () => {
    const { executionId } = await startedExecution();
    const step = await prisma.executionStep.findFirstOrThrow({ where: { executionId }, orderBy: { order: "asc" } });
    await prisma.executionStep.update({ where: { id: step.id }, data: { status: "RUNNING", attempts: 2 } });
    const zombie = await prisma.executionStep.updateMany({ where: { id: step.id, status: "RUNNING", attempts: 1 }, data: { status: "COMPLETED", output: "stale" } });
    expect(zombie.count).toBe(0);
  });

  it("a job that keeps dying is declared dead and its execution failed and refunded", async () => {
    const { user, executionId } = await startedExecution();
    const [job] = await claimJobs("dead-worker", 1, 60_000, true);
    await prisma.job.update({ where: { id: job.id }, data: { attempts: job.maxAttempts, lockedUntil: new Date(Date.now() - 1000) } });
    const r = await recoverExecutions();
    expect(r.dead).toBe(1);
    const ex = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
    expect(ex.status).toBe("FAILED");
    expect(ex.refundedCents).toBe(ex.costCents);
    expect(await balance(user.id)).toBe(5000);
  });

  it("an execution with no job (a lost enqueue) is picked up again", async () => {
    const { auth, executionId } = await startedExecution();
    await prisma.job.deleteMany({});
    await prisma.execution.update({ where: { id: executionId }, data: { lastProgressAt: new Date(Date.now() - 5 * 60_000) } });
    const r = await recoverExecutions();
    expect(r.orphans).toBe(1);
    await runWorker();
    expect((await getExecution(auth, executionId)).status).toBe("COMPLETED");
  });

  it("an execution with no progress for the stall window is failed and refunded — never stuck RUNNING", async () => {
    const { user, executionId } = await startedExecution();
    await prisma.execution.update({ where: { id: executionId }, data: { lastProgressAt: new Date(Date.now() - STALL_MS - 60_000) } });
    const r = await recoverExecutions();
    expect(r.stalled).toBe(1);
    expect((await prisma.execution.findUniqueOrThrow({ where: { id: executionId } })).status).toBe("FAILED");
    expect(await balance(user.id)).toBe(5000);
  });

  it("an approval nobody decides expires and the execution is cancelled", async () => {
    const { auth } = await createUser();
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await prisma.execution.update({ where: { id: executionId }, data: { lastProgressAt: new Date(Date.now() - 15 * 24 * 3600_000) } });
    const r = await recoverExecutions();
    expect(r.expired).toBe(1);
    expect((await getExecution(auth, executionId)).status).toBe("CANCELLED");
    expect((await api().get("/api/approvals").set(auth).expect(200)).body.approvals).toHaveLength(0);
  });
});

describe("live updates (SSE) from the persistent event log", () => {
  it("a reconnecting client resumes from its last event id and receives only newer events", async () => {
    const { auth, executionId } = await startedExecution();
    const before = await getExecution(auth, executionId);
    const cursor = before.lastEventId;
    expect(cursor).toBeGreaterThan(0);

    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const received: { id: number; type: string }[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: `/api/executions/${executionId}/stream?after=${cursor}`, headers: { ...auth, Accept: "text/event-stream" } },
        (res) => {
          expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
          let buf = "";
          res.on("data", (chunk) => {
            buf += chunk.toString();
            for (const block of buf.split("\n\n").slice(0, -1)) {
              const id = /^id: (\d+)$/m.exec(block)?.[1];
              const event = /^event: (.+)$/m.exec(block)?.[1];
              const data = /^data: (.+)$/m.exec(block)?.[1];
              if (event === "execution-event" && id && data) received.push({ id: Number(id), type: JSON.parse(data).type });
              if (event === "end") {
                req.destroy();
                resolve();
              }
            }
            buf = buf.split("\n\n").slice(-1)[0];
          });
        }
      );
      req.on("error", (e) => (received.length ? resolve() : reject(e)));
    });
    // The worker runs while the stream is open.
    await runWorker();
    await Promise.race([done, new Promise((r) => setTimeout(r, 8000))]);
    server.close();

    expect(received.length).toBeGreaterThan(5);
    expect(received.every((e) => e.id > cursor)).toBe(true);
    expect(received.map((e) => e.id)).toEqual([...received.map((e) => e.id)].sort((a, b) => a - b));
    expect(received.map((e) => e.type)).toContain("EXECUTION_COMPLETED");
  });

  it("the events endpoint rebuilds the timeline after a refresh", async () => {
    const { auth, executionId } = await startedExecution();
    await runWorker();
    const all = (await api().get(`/api/executions/${executionId}/events`).set(auth).expect(200)).body.events;
    const later = (await api().get(`/api/executions/${executionId}/events?after=${all[3].id}`).set(auth).expect(200)).body.events;
    expect(later).toEqual(all.slice(4));
  });
});
