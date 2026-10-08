// Step failures: retries with backoff, exceptions when retries are exhausted,
// resume after a person chooses Retry, and refunds on cancel / failure.
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { failExecution } from "../../src/engine/lifecycle";
import { api, approvePending, balance, createUser, defineObjective, fillContext, getExecution, runWorker, scriptLLM } from "../helpers";

describe("step failures and recovery paths", () => {
  it("retries a transient failure and completes", async () => {
    const { auth } = await createUser();
    await fillContext(auth);
    let failures = 0;
    scriptLLM((system, _user, opts) => {
      if (opts.purpose === "step" && /Market Research Analyst/.test(system) && failures < 2) {
        failures++;
        throw new Error("The AI provider is having problems right now (HTTP 503). Please try again later.");
      }
      return undefined;
    });
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    const research = ex.steps.find((s: { capability: string }) => s.capability === "market_research");
    expect(research.attempts).toBe(3);
    expect(ex.events.filter((e: { type: string }) => e.type === "STEP_RETRY_SCHEDULED")).toHaveLength(2);
  });

  it("blocks with an exception when retries are exhausted, then resumes on Retry without charging twice", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    let broken = true;
    scriptLLM((system, _user, opts) => {
      if (broken && opts.purpose === "step" && /Competitive Intelligence Analyst/.test(system)) throw new Error("socket hang up");
      return undefined;
    });
    const { executionId, objectiveId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    await runWorker();

    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const failed = ex.steps.find((s: { capability: string }) => s.capability === "competitor_analysis");
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/socket hang up/);
    // Work before the failure is kept.
    expect(ex.steps.filter((s: { status: string }) => s.status === "COMPLETED")).toHaveLength(2);
    const exceptions = (await api().get("/api/exceptions").set(auth).expect(200)).body.exceptions;
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({ kind: "STEP_FAILED", objectiveId, actions: ["retry", "cancel"] });
    expect(exceptions[0].whatHappened).toMatch(/Competitive Intelligence Analyst/);
    const afterCharge = await balance(user.id);

    broken = false;
    await api().post(`/api/exceptions/${exceptions[0].id}/resolve`).set(auth).send({ action: "retry" }).expect(200);
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(await balance(user.id)).toBe(afterCharge); // no second charge
    expect(ex.events.map((e: { type: string }) => e.type)).toContain("EXECUTION_RESUMED");
  });

  it("refunds the work that didn't run when a blocked execution is cancelled", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    scriptLLM((system, _u, opts) => (opts.purpose === "step" && /Competitive Intelligence Analyst/.test(system) ? Promise.reject(new Error("timeout")) : undefined));
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const unrun = ex.steps.filter((s: { status: string }) => s.status !== "COMPLETED").reduce((n: number, s: { costCents: number }) => n + s.costCents, 0) + 150;
    const before = await balance(user.id);
    await api().post(`/api/executions/${executionId}/cancel`).set(auth).expect(200);
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("CANCELLED");
    expect(ex.refundedCents).toBe(unrun);
    expect(await balance(user.id)).toBe(before + unrun);
    expect((await api().get("/api/exceptions").set(auth).expect(200)).body.exceptions).toHaveLength(0);
  });

  it("a step reply cut off at the token limit is never stored as completed", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    let truncate = true;
    scriptLLM((system, _user, opts) => {
      if (truncate && opts.purpose === "step" && /Market Research Analyst/.test(system)) return { text: "## Findings\n- Germany leads the European market with", truncated: true };
      return undefined;
    });
    const { executionId, objectiveId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const research = ex.steps.find((s: { capability: string }) => s.capability === "market_research");
    expect(research.status).toBe("FAILED");
    expect(research.output ?? "").not.toMatch(/leads the European market with$/);
    const { exceptions } = (await api().get(`/api/exceptions?status=OPEN`).set(auth).expect(200)).body;
    expect(exceptions[0].whatHappened).toMatch(/cut off at the AI model's output-token limit/);
    truncate = false;
    await api().post(`/api/exceptions/${exceptions[0].id}/resolve`).set(auth).send({ action: "retry" }).expect(200);
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(objectiveId).toBeTruthy();
  });

  it("a configuration error blocks immediately (no pointless retries)", async () => {
    const { auth } = await createUser();
    await fillContext(auth);
    scriptLLM((_s, _u, opts) => (opts.purpose === "step" ? Promise.reject(new Error("The AI provider isn't configured: OPENAI_API_KEY is missing on the server.")) : undefined));
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    expect(ex.steps[0].attempts).toBe(1);
    expect(ex.exceptions[0].recommendation).toMatch(/misconfigured/);
  });

  it("failing an execution refunds exactly once, however often it is called", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    const charged = 5000 - (await balance(user.id));
    expect(charged).toBeGreaterThan(0);
    const results = await Promise.all([failExecution(executionId, "boom"), failExecution(executionId, "boom"), failExecution(executionId, "boom")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await balance(user.id)).toBe(5000);
    const refunds = await prisma.transaction.findMany({ where: { executionId, type: "REFUND" } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amountCents).toBe(charged);
  });
});
