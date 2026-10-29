// The monetary guard: a run whose provider cost would pass its limit stops before spending more and
// is refunded; a run within its limit is untouched; without prices the guard can't measure money
// and says so, leaving the token ceiling in charge. Mock model only — prices come from a test table.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { config } from "../../src/config";
import { COST_LIMIT_MESSAGE, costLimitEurMicros, estimateRemaining, remainingWork, spentSoFar } from "../../src/engine/costGuard";
import { api, balance, createUser, defineObjective, fillContext, getExecution, runWorker } from "../helpers";

const saved = { pricing: process.env.PROVIDER_PRICING, guard: { ...config.costGuard } };
afterEach(() => {
  if (saved.pricing === undefined) delete process.env.PROVIDER_PRICING;
  else process.env.PROVIDER_PRICING = saved.pricing;
  Object.assign(config.costGuard, saved.guard);
});

/** Prices the mock model at `perMTok` USD per million tokens (in and out), 1 USD = 0.9 EUR. */
const priceMock = (perMTok: number) => {
  process.env.PROVIDER_PRICING = JSON.stringify({ models: { mock: { inputPerMTok: perMTok, outputPerMTok: perMTok, currency: "USD" } }, fx: { USD: 0.9 } });
};

async function approveAndRun(auth: Record<string, string>) {
  await runWorker(); // planned, waiting for approval
  const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
  await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
  await runWorker();
}

describe("cost guard: estimates", () => {
  it("prices the remaining plan conservatively from the configured table; unpriced models are reported, not guessed", () => {
    priceMock(1); // $1 per million tokens
    config.costGuard.estimatedInputTokensPerCall = 10_000;
    const out = Number(process.env.OPENAI_MAX_TOKENS) || 8192;
    const perMainCall = Math.round((10_000 + out) * 1 * 0.9); // micro-EUR, rounded per call like the guard
    // A framing step (no web research) + verification (2 calls) = 3 main calls; search is off in this suite.
    const est = estimateRemaining(remainingWork([{ status: "PENDING", capability: "objective_framing" }], "step"));
    expect(est).toEqual({ eurMicros: perMainCall * 3, priced: true });
    // Verification alone.
    expect(estimateRemaining(remainingWork([], "verification")).eurMicros).toBe(perMainCall * 2);
    // Completed and skipped steps cost nothing more.
    expect(remainingWork([{ status: "COMPLETED", capability: "market_research" }, { status: "SKIPPED", capability: "market_research" }], "step")).toEqual([{ verification: true }]);
    delete process.env.PROVIDER_PRICING;
    expect(estimateRemaining(remainingWork([], "verification")).priced).toBe(false);
  });

  it("the limit is the smaller of the absolute cap and the share of the run's price; 0 turns a limit off", () => {
    config.costGuard.maxShareOfPrice = 0.3;
    config.costGuard.maxEur = 0;
    expect(costLimitEurMicros({ costCents: 1150 })).toBe(3_450_000); // 30% of €11.50
    config.costGuard.maxEur = 2;
    expect(costLimitEurMicros({ costCents: 1150 })).toBe(2_000_000);
    config.costGuard.maxShareOfPrice = 0;
    config.costGuard.maxEur = 0;
    expect(costLimitEurMicros({ costCents: 1150 })).toBeNull();
  });
});

describe("cost guard: executions", () => {
  it("a plan whose estimated provider cost passes the limit stops before its first step and is refunded in full", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceMock(1_000); // a deliberately expensive model: one call ≈ €21 at the conservative size
    await approveAndRun(auth);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toBe(COST_LIMIT_MESSAGE);
    // Nothing ran after planning: no step completed, no step model call.
    expect(ex.steps.every((s: { status: string }) => s.status !== "COMPLETED")).toBe(true);
    expect(await prisma.usageEvent.count({ where: { executionId, kind: "llm", purpose: "step" } })).toBe(0);
    expect(ex.refundedCents).toBe(ex.costCents);
    expect(await balance(user.id)).toBe(5000);
    // The customer-facing message carries no provider cost.
    expect(ex.errorMessage).not.toMatch(/€|\$|EUR|USD/);
  });

  it("a run within its limit completes as before, and what it cost is recorded", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceMock(0.01);
    await approveAndRun(auth);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    const spent = await spentSoFar(executionId);
    expect(spent.priced).toBe(true);
    expect(spent.eurMicros).toBeGreaterThan(0);
    expect(spent.eurMicros).toBeLessThan(costLimitEurMicros(ex)!);
  });

  it("without prices the guard can't measure money: the run goes on (the token ceiling still applies)", async () => {
    delete process.env.PROVIDER_PRICING;
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await approveAndRun(auth);
    expect((await getExecution(auth, executionId)).status).toBe("COMPLETED");
  });

  it("a run already over its limit stops even when the rest can't be priced; failed calls count at their estimated tokens", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker();
    // A failed call on a priced model (no recorded cost) — e.g. a long reply cut off by a timeout.
    process.env.PROVIDER_PRICING = JSON.stringify({ models: { "costly-model": { inputPerMTok: 100, outputPerMTok: 100, currency: "EUR" } } });
    await prisma.usageEvent.create({ data: { kind: "llm", provider: "openai", model: "costly-model", tokensIn: 30_000, tokensOut: 20_000, ok: false, estimated: true, executionId } });
    // 50k tokens × €100/M. The planner's own (mock, unpriced) call makes this a lower bound: priced is false.
    expect(await spentSoFar(executionId)).toEqual({ eurMicros: 5_000_000, priced: false });
    // Nothing else can be priced either — but even the lower bound, €5, is over this run's €3.45.
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toBe(COST_LIMIT_MESSAGE);
    expect(await balance(user.id)).toBe(5000);
  });
});
