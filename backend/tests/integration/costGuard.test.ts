// The monetary guard: a run whose provider cost would pass its limit stops before spending more and
// is refunded; a run within its limit is untouched; what can't be priced stops the run (or, with
// COST_GUARD_UNPRICED=allow, is reported and checked as a lower bound); a failure of the guard itself
// stops the run while a limit applies. Mock model only — prices come from a test table, no paid call runs.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { config } from "../../src/config";
import { refundExecution } from "../../src/engine/billing";
import {
  COST_LIMIT_MESSAGE,
  COST_UNCHECKED_MESSAGE,
  costGuardWarnings,
  costLimitEurMicros,
  costTotal,
  estimateRemaining,
  remainingWork,
  spentSoFar,
} from "../../src/engine/costGuard";
import { failExecution } from "../../src/engine/lifecycle";
import { ASSESSOR_MAX_TOKENS } from "../../src/engine/verification/assessor";
import { CLAIM_CHECK_MAX_TOKENS } from "../../src/engine/verification/claimCheck";
import { MEMORY_MAX_TOKENS } from "../../src/engine/learning";
import { QUERY_MAX_TOKENS } from "../../src/research/sources";
import { api, balance, createUser, defineObjective, fillContext, getExecution, runWorker, scriptLLM } from "../helpers";

const saved = {
  pricing: process.env.PROVIDER_PRICING,
  render: process.env.RENDER,
  guard: { ...config.costGuard },
  search: { ...config.search },
  maxTokens: config.maxTokensPerExecution,
};
afterEach(() => {
  if (saved.pricing === undefined) delete process.env.PROVIDER_PRICING;
  else process.env.PROVIDER_PRICING = saved.pricing;
  if (saved.render === undefined) delete process.env.RENDER;
  else process.env.RENDER = saved.render;
  Object.assign(config.costGuard, saved.guard);
  Object.assign(config.search, saved.search);
  config.maxTokensPerExecution = saved.maxTokens;
});

/** Prices the mock model at `perMTok` USD per million tokens (in and out), 1 USD = 0.9 EUR, plus `extra` table entries. */
const priceMock = (perMTok: number, extra: { tools?: Record<string, unknown>; fx?: Record<string, number> } = {}) => {
  process.env.PROVIDER_PRICING = JSON.stringify({
    models: { mock: { inputPerMTok: perMTok, outputPerMTok: perMTok, currency: "USD" } },
    tools: extra.tools ?? {},
    fx: extra.fx ?? { USD: 0.9 },
  });
};
/** One mock call at $1/M tokens in micro-EUR, rounded per call like the guard. */
const call = (tokensIn: number, tokensOut: number) => Math.round((tokensIn + tokensOut) * 0.9);
/** Live web search configured (Tavily with a key): nothing here runs a search — only the estimate reads this. */
const tavilyOn = () => Object.assign(config.search, { provider: "tavily", tavilyApiKey: "test-key-not-used" });

async function approveAndRun(auth: Record<string, string>) {
  await runWorker(); // planned, waiting for approval
  const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
  await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
  await runWorker();
}

const ledger = (userId: string) => prisma.transaction.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

/** Refunded exactly once, in full: one REFUND row, the balance back where it started, and nothing more to refund. */
async function expectRefundedOnce(userId: string, executionId: string) {
  const ex = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
  expect(ex.costCents).toBeGreaterThan(0);
  expect(ex.refundedCents).toBe(ex.costCents);
  const rows = await ledger(userId);
  expect(rows.map((t) => t.reason)).toEqual(["execution_charge", "execution_failed"]);
  expect(rows.filter((t) => t.type === "REFUND")).toHaveLength(1);
  expect(rows[0].amountCents + rows[1].amountCents).toBe(0);
  expect(rows[1].balanceAfter).toBe(5000);
  expect(await balance(userId)).toBe(5000);
  expect(await prisma.executionEvent.count({ where: { executionId, type: "EXECUTION_FAILED" } })).toBe(1);
  expect(await prisma.executionEvent.count({ where: { executionId, type: "FUNDS_REFUNDED" } })).toBe(1);
}

describe("cost guard: estimates", () => {
  it("prices the remaining plan conservatively from the configured table: each call at its own output cap, repairs and the memory call included", () => {
    priceMock(1); // $1 per million tokens
    config.costGuard.estimatedInputTokensPerCall = 10_000;
    const out = Number(process.env.OPENAI_MAX_TOKENS) || 8192;
    // Verification: the assessor and the claim check, each with its repair call (1.5× the cap).
    const verification = [ASSESSOR_MAX_TOKENS, CLAIM_CHECK_MAX_TOKENS].reduce((n, cap) => n + call(10_000, cap) + call(10_000, Math.round(cap * 1.5)), 0);
    const memory = call(10_000, MEMORY_MAX_TOKENS);
    // A framing step (no web research) + verification + memory; search is off in this suite.
    const est = estimateRemaining(remainingWork([{ status: "PENDING", capability: "objective_framing" }], "step"));
    expect(est).toEqual({ measuredMicros: 0, estimatedMicros: call(10_000, out) + verification + memory, unpriced: [] });
    expect(costTotal(estimateRemaining(remainingWork([], "verification")))).toBe(verification + memory);
    expect(costTotal(estimateRemaining(remainingWork([], "memory")))).toBe(memory);
    // Completed and skipped steps cost nothing more.
    expect(remainingWork([{ status: "COMPLETED", capability: "market_research" }, { status: "SKIPPED", capability: "market_research" }], "step")).toEqual([{ verification: true }, { memory: true }]);
  });

  it("a research step adds the query writer at its real output cap and its paid searches", () => {
    priceMock(1, { tools: { "search:tavily": { perCall: 0.01, currency: "USD" } } });
    config.costGuard.estimatedInputTokensPerCall = 10_000;
    const out = Number(process.env.OPENAI_MAX_TOKENS) || 8192;
    const step = [{ status: "PENDING" as const, capability: "market_research" }];
    const units = remainingWork(step, "step").slice(0, 1);
    // Search off: the step call and the query writer (2,000 in, 2,048 out), no search.
    expect(estimateRemaining(units)).toEqual({ measuredMicros: 0, estimatedMicros: call(10_000, out) + call(2_000, QUERY_MAX_TOKENS), unpriced: [] });
    tavilyOn();
    // Three searches at $0.01 = 30,000 micro-USD = 27,000 micro-EUR.
    expect(estimateRemaining(units).estimatedMicros).toBe(call(10_000, out) + call(2_000, QUERY_MAX_TOKENS) + 27_000);
  });

  it("missing prices are reported by name and never counted as free: a model, a paid search, an exchange rate", () => {
    const step = [{ status: "PENDING" as const, capability: "market_research" }];
    // A table without the model in use.
    process.env.PROVIDER_PRICING = JSON.stringify({ models: { "some-other-model": { inputPerMTok: 1, outputPerMTok: 1, currency: "EUR" } } });
    expect(estimateRemaining(remainingWork(step, "step"))).toEqual({ measuredMicros: 0, estimatedMicros: 0, unpriced: ["model mock:mock"] });
    // The model is priced, live search is on, the search isn't: the priced part is still counted.
    priceMock(1);
    tavilyOn();
    const mixed = estimateRemaining(remainingWork(step, "step"));
    expect(mixed.unpriced).toEqual(["search:tavily"]);
    expect(mixed.estimatedMicros).toBeGreaterThan(0);
    // A price in a currency without an exchange rate.
    priceMock(1, { fx: {}, tools: { "search:tavily": { perCall: 0.01, currency: "USD" } } });
    expect(estimateRemaining(remainingWork(step, "step")).unpriced).toEqual(["fx USD"]);
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

  it("the boot warning says what the guard can't price, and what happens to runs", () => {
    process.env.RENDER = "true"; // a hosting platform: warnings apply
    scriptLLM(() => undefined); // the models in use are the mock's (on a host, the mock itself is refused)
    delete process.env.PROVIDER_PRICING;
    expect(costGuardWarnings()).toEqual([expect.stringMatching(/^PROVIDER_PRICING is not set: the monetary cost guard can't price anything and is inactive/)]);
    process.env.PROVIDER_PRICING = "{not json";
    expect(costGuardWarnings()).toEqual([expect.stringMatching(/not valid JSON.*all runs stop before spending more and are refunded \(COST_GUARD_UNPRICED=stop\)/)]);
    priceMock(1);
    expect(costGuardWarnings()).toEqual([]);
    tavilyOn();
    expect(costGuardWarnings()).toEqual(["PROVIDER_PRICING has no price for search:tavily: runs with web research stop before spending more and are refunded (COST_GUARD_UNPRICED=stop)."]);
    config.costGuard.unpriced = "allow";
    expect(costGuardWarnings()[0]).toMatch(/the guard checks only the priced part of runs with web research \(COST_GUARD_UNPRICED=allow\)/);
    config.costGuard.maxEur = 0;
    config.costGuard.maxShareOfPrice = 0;
    expect(costGuardWarnings()).toEqual([expect.stringMatching(/^The monetary cost guard is off/)]);
  });
});

describe("cost guard: what was spent", () => {
  it("separates measured from estimated cost, and reports what it can't price instead of counting it free", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth); // not planned yet: no usage
    process.env.PROVIDER_PRICING = JSON.stringify({
      models: { priced: { inputPerMTok: 1, outputPerMTok: 1, currency: "EUR" } },
      tools: { "search:tavily": { perCall: 0.01, currency: "EUR" } },
    });
    const llm = { kind: "llm", provider: "openai", model: "priced", executionId };
    await prisma.usageEvent.createMany({
      data: [
        // Provider-reported usage, priced when recorded: measured. The two extra HTTP attempts may have been billed
        // for their input: estimated.
        { ...llm, tokensIn: 1_000, tokensOut: 500, costMicros: 1_500, costCurrency: "EUR", costSource: "computed", attempts: 3 },
        // A failed call (recorded without a cost): estimated at its estimated tokens.
        { ...llm, tokensIn: 2_000, tokensOut: 0, ok: false, estimated: true },
        // A paid search, priced when recorded: measured. A failed one: estimated at its price.
        { kind: "search", provider: "tavily", executionId, costMicros: 10_000, costCurrency: "EUR", costSource: "computed" },
        { kind: "search", provider: "tavily", executionId, ok: false },
        // Wikipedia is free by design.
        { kind: "search", provider: "wikipedia", executionId },
      ],
    });
    expect(await spentSoFar(executionId)).toEqual({ measuredMicros: 1_500 + 10_000, estimatedMicros: 2 * 1_000 + 2_000 + 10_000, unpriced: [] });
    // A search with no price, a model with no price, a cost in a currency with no rate: reported, not free.
    await prisma.usageEvent.createMany({
      data: [
        { kind: "search", provider: "tavily", executionId },
        { kind: "llm", provider: "openai", model: "unpriced-model", tokensIn: 100, tokensOut: 100, executionId },
        { kind: "llm", provider: "openai", model: "priced", tokensIn: 100, tokensOut: 100, costMicros: 200, costCurrency: "USD", costSource: "computed", executionId },
      ],
    });
    // The table now prices nothing for searches.
    process.env.PROVIDER_PRICING = JSON.stringify({ models: { priced: { inputPerMTok: 1, outputPerMTok: 1, currency: "EUR" } } });
    const spent = await spentSoFar(executionId);
    expect(spent.unpriced).toEqual(["fx USD", "model openai:unpriced-model", "search:tavily"]);
    // What was priced when it was recorded stays measured.
    expect(spent.measuredMicros).toBe(1_500 + 10_000);
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
    await expectRefundedOnce(user.id, executionId);
    // The customer-facing message carries no provider cost.
    expect(ex.errorMessage).not.toMatch(/€|\$|EUR|USD/);
  });

  it("a run within its limit completes as before, the memory call included, and what it cost is recorded", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceMock(0.01);
    await approveAndRun(auth);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(await prisma.usageEvent.count({ where: { executionId, purpose: "memory" } })).toBe(1);
    const spent = await spentSoFar(executionId);
    expect(spent.unpriced).toEqual([]);
    // The mock reports no usage: its token counts are estimates, so its cost is too.
    expect(spent.estimatedMicros).toBeGreaterThan(0);
    expect(costTotal(spent)).toBeLessThan(costLimitEurMicros(ex)!);
  });

  it("without PROVIDER_PRICING the guard is inactive and the run goes on (the token ceiling still applies)", async () => {
    delete process.env.PROVIDER_PRICING;
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await approveAndRun(auth);
    expect((await getExecution(auth, executionId)).status).toBe("COMPLETED");
  });

  it("with PROVIDER_PRICING set, a model in use with no price stops the run before its first step and refunds it", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    process.env.PROVIDER_PRICING = JSON.stringify({ models: { "some-other-model": { inputPerMTok: 1, outputPerMTok: 1, currency: "EUR" } } });
    await approveAndRun(auth);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toBe(COST_UNCHECKED_MESSAGE);
    expect(ex.errorMessage).not.toMatch(/€|\$|EUR|USD|mock/);
    expect(await prisma.usageEvent.count({ where: { executionId, purpose: "step" } })).toBe(0);
    await expectRefundedOnce(user.id, executionId);
  });

  it("an unpriced paid search already made stops the run; COST_GUARD_UNPRICED=allow lets it go on", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker(); // planned
    priceMock(0.01); // the model is priced; search:tavily isn't
    await prisma.usageEvent.create({ data: { kind: "search", provider: "tavily", ok: true, executionId } });
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toBe(COST_UNCHECKED_MESSAGE);
    await expectRefundedOnce(user.id, executionId);

    // The same, with the documented opt-out: the priced part is checked as a lower bound and the run completes.
    config.costGuard.unpriced = "allow";
    const second = await createUser({ credits: 5000 });
    await fillContext(second.auth);
    const run2 = await defineObjective(second.auth);
    await runWorker();
    await prisma.usageEvent.create({ data: { kind: "search", provider: "tavily", ok: true, executionId: run2.executionId } });
    const [b] = (await api().get("/api/approvals").set(second.auth).expect(200)).body.approvals;
    await api().post(`/api/approvals/${b.id}/approve`).set(second.auth).send({}).expect(200);
    await runWorker();
    expect((await getExecution(second.auth, run2.executionId)).status).toBe("COMPLETED");
  });

  it("a run already over its limit stops even when the rest can't be priced; failed calls count at their estimated tokens", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker();
    // A failed call on a priced model (no recorded cost) — e.g. a long reply cut off by a timeout.
    process.env.PROVIDER_PRICING = JSON.stringify({ models: { "costly-model": { inputPerMTok: 100, outputPerMTok: 100, currency: "EUR" } } });
    await prisma.usageEvent.create({ data: { kind: "llm", provider: "openai", model: "costly-model", tokensIn: 30_000, tokensOut: 20_000, ok: false, estimated: true, executionId } });
    // 50k tokens × €100/M, estimated. The planner's own (mock, unpriced) call is reported as unpriced.
    expect(await spentSoFar(executionId)).toEqual({ measuredMicros: 0, estimatedMicros: 5_000_000, unpriced: ["model mock:mock"] });
    // Even the priced part, €5, is over this run's €3.45: the limit message, not the "couldn't check" one —
    // and with COST_GUARD_UNPRICED=allow too.
    config.costGuard.unpriced = "allow";
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toBe(COST_LIMIT_MESSAGE);
    await expectRefundedOnce(user.id, executionId);
  });

  it("the token ceiling is still checked first, and still stops and refunds a run the cost guard would also stop", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceMock(1_000);
    config.maxTokensPerExecution = 10;
    await approveAndRun(auth);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toMatch(/^Stopped at the safety limit: this execution used [\d,]+ model tokens \(limit 10\)\. Its credits are refunded\.$/);
    await expectRefundedOnce(user.id, executionId);
  });
});

describe("cost guard: when the guard itself fails", () => {
  // The guard's own usage read fails (the token ceiling's aggregate and every other query still work). A plain
  // swap of the delegate's method, put back in afterEach: vi.spyOn's restore leaves a Prisma delegate without it.
  const usage = prisma.usageEvent as unknown as { findMany: (args?: { select?: { costSource?: boolean } }) => Promise<unknown> };
  const originalFindMany = usage.findMany;
  let guardReads = 0;
  afterEach(() => {
    usage.findMany = originalFindMany;
  });
  const breakGuardRead = () => {
    guardReads = 0;
    usage.findMany = (args) => {
      if (!args?.select?.costSource) return originalFindMany.call(usage, args);
      guardReads++;
      return Promise.reject(new Error("simulated database failure"));
    };
  };

  it("with a limit in force it stops the run before spending more, refunded once, with one failure transition", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceMock(0.01);
    await runWorker(); // planned
    breakGuardRead();
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
    await runWorker();
    expect(guardReads).toBeGreaterThan(0);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toBe(COST_UNCHECKED_MESSAGE);
    expect(await prisma.usageEvent.count({ where: { executionId, purpose: "step" } })).toBe(0);
    expect(ex.steps.every((s: { status: string }) => s.status === "SKIPPED")).toBe(true);
    await expectRefundedOnce(user.id, executionId);
    // Running the worker again, or failing the execution again, changes nothing.
    usage.findMany = originalFindMany;
    await runWorker();
    expect(await failExecution(executionId, "again")).toBe(false);
    await expectRefundedOnce(user.id, executionId);
  });

  it("with both limits deliberately off it is never consulted, and the run completes as before", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceMock(1_000); // would stop the run if a limit applied
    config.costGuard.maxEur = 0;
    config.costGuard.maxShareOfPrice = 0;
    breakGuardRead();
    await approveAndRun(auth);
    expect(guardReads).toBe(0);
    expect((await getExecution(auth, executionId)).status).toBe("COMPLETED");
  });
});

describe("cost guard: stopping mid-run", () => {
  /** Makes the model expensive from the first call of the step chosen by `which` onwards: everything after it is over the limit. */
  function priceRisesDuring(which: "first step" | "last step" | "verification") {
    priceMock(0.01);
    scriptLLM(async (_system, _user, opts) => {
      if (which === "verification" && (opts.purpose === "verify" || opts.purpose === "verify_claims")) priceMock(1_000);
      if (opts.purpose !== "step" || !opts.stepId || which === "verification") return undefined;
      const step = await prisma.executionStep.findUniqueOrThrow({ where: { id: opts.stepId } });
      const orders = (await prisma.executionStep.findMany({ where: { executionId: step.executionId }, select: { order: true } })).map((s) => s.order);
      if (step.order === (which === "first step" ? Math.min(...orders) : Math.max(...orders))) priceMock(1_000);
      return undefined;
    });
  }

  it("stops after a completed step, before the next one: pending work is skipped, the full charge is refunded exactly once", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceRisesDuring("first step");
    await approveAndRun(auth);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toBe(COST_LIMIT_MESSAGE);
    const steps = (ex.steps as { status: string; order: number }[]).sort((a, b) => a.order - b.order);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps[0].status).toBe("COMPLETED");
    expect(steps.slice(1).every((s) => s.status === "SKIPPED")).toBe(true);
    // Exactly one step call ran, and nothing after it.
    expect(await prisma.usageEvent.count({ where: { executionId, purpose: "step" } })).toBe(1);
    expect(await prisma.usageEvent.count({ where: { executionId, purpose: { in: ["verify", "verify_claims", "memory"] } } })).toBe(0);
    expect(await prisma.approval.count({ where: { executionId, status: "PENDING" } })).toBe(0);
    await expectRefundedOnce(user.id, executionId);

    // A repeated failure — the worker again, failExecution again, a stray refund — refunds nothing more.
    await runWorker();
    expect(await failExecution(executionId, COST_LIMIT_MESSAGE)).toBe(false);
    expect(await prisma.$transaction((tx) => refundExecution(tx, executionId, ex.costCents, "execution_failed"))).toBe(0);
    await expectRefundedOnce(user.id, executionId);
    expect((await getExecution(auth, executionId)).status).toBe("FAILED");
  });

  it("stops after the last step, before verification, and is refunded in full", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceRisesDuring("last step");
    await approveAndRun(auth);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toBe(COST_LIMIT_MESSAGE);
    expect(ex.steps.every((s: { status: string }) => s.status === "COMPLETED")).toBe(true);
    expect(await prisma.usageEvent.count({ where: { executionId, purpose: { in: ["verify", "verify_claims", "memory"] } } })).toBe(0);
    await expectRefundedOnce(user.id, executionId);
  });

  it("over the limit after verification: the result is kept and the memory call is skipped", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    priceRisesDuring("verification");
    await approveAndRun(auth);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(await prisma.usageEvent.count({ where: { executionId, purpose: { in: ["verify", "verify_claims"] } } })).toBeGreaterThan(0);
    expect(await prisma.usageEvent.count({ where: { executionId, purpose: "memory" } })).toBe(0);
    // Completed: charged, nothing refunded.
    expect(ex.refundedCents).toBe(0);
    expect(await balance(user.id)).toBe(5000 - ex.costCents);
  });
});
