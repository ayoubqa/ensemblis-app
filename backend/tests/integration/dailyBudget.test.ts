// The server-wide daily token budget: new work is refused before any model call once today's
// remaining budget can't cover one execution, and every model call stops once the budget is used.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { config } from "../../src/config";
import { noteTokensUsed, resetDailyBudgetForTests, tokensUsedToday } from "../../src/ai/dailyBudget";
import { api, approvePending, balance, createUser, defineObjective, fillContext, getExecution, runWorker, scriptLLM } from "../helpers";

describe("daily token budget", () => {
  const before = { budget: config.dailyTokenBudget, cap: config.maxTokensPerExecution };
  beforeEach(() => resetDailyBudgetForTests());
  afterEach(() => {
    config.dailyTokenBudget = before.budget;
    config.maxTokensPerExecution = before.cap;
    resetDailyBudgetForTests();
  });

  it("counts every model call of the day, failed ones included", async () => {
    await prisma.usageEvent.createMany({
      data: [
        { kind: "llm", provider: "openai", model: "m", tokensIn: 1000, tokensOut: 500, ok: true },
        { kind: "llm", provider: "openai", model: "m", tokensIn: 300, tokensOut: 0, ok: false, estimated: true },
        { kind: "search", provider: "tavily", tokensIn: 0, tokensOut: 0, ok: true },
        { kind: "llm", provider: "openai", model: "m", tokensIn: 9999, tokensOut: 9999, ok: true, createdAt: new Date(Date.now() - 2 * 24 * 3600_000) },
      ],
    });
    expect(await tokensUsedToday()).toBe(1800);
  });

  it("refuses new work, before any model call, when the rest of today's budget can't finish an execution", async () => {
    config.maxTokensPerExecution = 100_000;
    config.dailyTokenBudget = 1_000_000;
    await prisma.usageEvent.create({ data: { kind: "llm", provider: "openai", model: "m", tokensIn: 950_000, tokensOut: 0, ok: true } });
    let calls = 0;
    scriptLLM(() => {
      calls++;
      return undefined;
    });
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const res = await api().post("/api/objectives").set(auth).send({ statement: "Recommend the two best European markets for our liquid-cooling product." }).expect(429);
    expect(res.body.error).toMatch(/today's AI processing quota/);
    expect(calls).toBe(0);
    expect(await prisma.objective.count()).toBe(0);

    // Enough left for one more execution: allowed.
    config.dailyTokenBudget = 1_100_000;
    await api().post("/api/objectives").set(auth).send({ statement: "Recommend the two best European markets for our liquid-cooling product." }).expect(201);
  });

  it("stops a running execution at the budget: no retry loop, a person decides, and cancelling refunds the work that didn't run", async () => {
    config.dailyTokenBudget = 5_000_000;
    let calls = 0;
    let stepCalls = 0;
    scriptLLM((system, _u, opts) => {
      calls++;
      if (opts.purpose === "step" && /Market Research Analyst/.test(system)) {
        stepCalls++;
        noteTokensUsed(10_000_000); // as if this step's calls had used up the day
      }
      return undefined;
    });
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    const afterCharge = await balance(user.id);
    await runWorker();

    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const callsAtStop = calls;
    expect(stepCalls).toBe(1);
    const next = ex.steps.find((s: { capability: string }) => s.capability === "competitor_analysis");
    expect(next.status).toBe("FAILED");
    expect(next.attempts).toBe(1); // not retried in a loop
    expect(next.error).toMatch(/today's AI processing quota/);
    const exc = ex.exceptions.find((x: { status: string }) => x.status === "OPEN");
    // Said as what it is: our own daily quota, not a provider problem.
    expect(exc.recommendation).toMatch(/Retry after midnight UTC/);
    expect(exc.recommendation).not.toMatch(/provider/i);

    // Nothing else calls the model while it waits.
    await runWorker();
    expect(calls).toBe(callsAtStop);

    await api().post(`/api/exceptions/${exc.id}/resolve`).set(auth).send({ action: "cancel" }).expect(200);
    const refunded = (await balance(user.id)) - afterCharge;
    expect(refunded).toBeGreaterThan(0);
    const done = await getExecution(auth, executionId);
    expect(done.status).toBe("CANCELLED");
    expect(done.refundedCents).toBe(refunded);
  });
});
