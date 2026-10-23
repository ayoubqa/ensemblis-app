// Usage events carry their variable cost when a price is configured, and the
// operator-only economics endpoints add it up against the credits consumed.

import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { recordUnrecordedOpeningBalances } from "../../src/lib/ledger";
import { api, createUser, defineObjective, fillContext, getExecution, runWorker } from "../helpers";

const PRICES = { models: { mock: { inputPerMTok: 1, outputPerMTok: 4, currency: "USD" } }, fx: { USD: 0.9 } };

describe("execution economics", () => {
  afterEach(() => {
    delete process.env.PROVIDER_PRICING;
  });

  it("without a price table, usage is recorded but left unpriced", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth, { autonomy: "AUTO_WITHIN_BUDGET" });
    await runWorker();
    const events = await prisma.usageEvent.findMany({ where: { executionId, kind: "llm" } });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.costMicros === null && e.costSource === null)).toBe(true);
    // Step calls are linked to their step.
    const steps = await prisma.executionStep.findMany({ where: { executionId }, select: { id: true } });
    const stepIds = new Set(steps.map((s) => s.id));
    expect(events.some((e) => e.purpose === "step" && e.stepId && stepIds.has(e.stepId))).toBe(true);
  });

  it("with a price table, each call is priced (marked estimated when tokens were) and the owner sees margin per execution", async () => {
    process.env.PROVIDER_PRICING = JSON.stringify(PRICES);
    const owner = await createUser({ email: "owner@example.com", verified: true, credits: 5000 });
    // The test helper sets the balance directly, like accounts from before the ledger: record it as their opening balance.
    expect(await recordUnrecordedOpeningBalances()).toBe(1);
    await fillContext(owner.auth);
    const { executionId } = await defineObjective(owner.auth, { autonomy: "AUTO_WITHIN_BUDGET" });
    await runWorker();
    const ex = await getExecution(owner.auth, executionId);
    expect(ex.status).toBe("COMPLETED");

    const events = await prisma.usageEvent.findMany({ where: { executionId, kind: "llm" } });
    for (const e of events) {
      expect(e.costMicros).toBe(e.tokensIn * 1 + e.tokensOut * 4);
      expect(e.costCurrency).toBe("USD");
      expect(e.costSource).toBe("estimated"); // the mock model reports no usage
    }
    const totalUsdMicros = events.reduce((n, e) => n + (e.costMicros ?? 0), 0);

    const r = (await api().get(`/api/admin/executions/${executionId}/economics`).set(owner.auth).expect(200)).body;
    expect(r.credits).toEqual({ estimated: ex.estimatedCostCents, charged: ex.costCents, refunded: 0, net: ex.costCents });
    expect(r.creditValueEurCents).toBe(ex.costCents); // 100 credits per €1
    expect(r.variableCost).toMatchObject({ complete: true, pricedEvents: events.length, estimatedTokenEvents: events.length, eurMicros: Math.round(totalUsdMicros * 0.9) });
    const costCents = Math.round(totalUsdMicros * 0.9) / 10_000;
    expect(r.variableContributionEurCents).toBeCloseTo(ex.costCents - costCents, 2);
    expect(r.variableMarginPct).toBeCloseTo(((ex.costCents - costCents) / ex.costCents) * 100, 0);
    // The mock model reports no usage, so every euro of it is an estimate.
    expect(r.variableCost).toMatchObject({ measuredEurMicros: 0, estimatedEurMicros: Math.round(totalUsdMicros * 0.9) });
    expect(r.excludedCosts).toEqual(expect.arrayContaining([expect.stringMatching(/hosting.*not allocated per execution/), "taxes", "labour"]));
    expect(r.suggestedCreditsNote).toMatch(/variable API\/tool cost/);

    const summary = (await api().get("/api/admin/economics?days=7&margin=0.8").set(owner.auth).expect(200)).body;
    expect(summary.executions).toMatchObject({ total: 1, completed: 1 });
    expect(summary.credits).toMatchObject({ charged: ex.costCents, net: ex.costCents, perCompletedExecution: ex.costCents });
    expect(summary.costPerCompletedExecutionEurMicros).toBe(Math.round(totalUsdMicros * 0.9));
    expect(summary.pricing).toMatchObject({ configuredModels: ["mock"], fxCurrencies: ["USD"], problem: null, asOf: null, stale: false });
    // Fixed plans aren't configured: unknown (null), never zero — so there is no all-in figure either.
    expect(summary.fixedCost).toEqual({ eurCents: null, items: {} });
    expect(summary.operatingContributionEurCents).toBeNull();
    expect(summary.excludedCosts).toEqual(expect.arrayContaining(["fixed hosting and database plans (not configured)"]));
    // No purchases: no cash, and no fees (a fact, not an assumption).
    expect(summary.cash).toEqual({ purchases: 0, collectedEurCents: 0 });
    expect(summary.paymentFeesEurCents).toBe(0);
    // Nothing in either report reads as profit except the disclaimer that it isn't.
    for (const body of [r, summary]) {
      expect(body.notNetProfit).toMatch(/^Not net profit/);
      expect(Object.keys(body).filter((k) => /profit/i.test(k))).toEqual(["notNetProfit"]);
    }

    // Value records: execution cost is recorded in credits; rows written before the credits release ("eur_cents", same integer) still count.
    const cost = await prisma.valueRecord.findFirstOrThrow({ where: { executionId, metric: "execution_cost" } });
    expect(cost).toMatchObject({ unit: "credits", value: ex.costCents });
    await prisma.valueRecord.create({ data: { orgId: cost.orgId, metric: "execution_cost", value: 120, unit: "eur_cents" } });
    const dash = (await api().get("/api/dashboard").set(owner.auth).expect(200)).body;
    expect(dash.value30d.executionCostCents).toBe(ex.costCents + 120);

    const overview = (await api().get("/api/admin/overview").set(owner.auth).expect(200)).body;
    expect(overview.ledger.mismatches).toBe(0);
  });

  it("with fixed plans and payment fees configured, reports cash, fees and an all-in contribution that is still not net profit", async () => {
    process.env.PROVIDER_PRICING = JSON.stringify({ ...PRICES, fixedMonthlyEur: { render: 7 }, paymentFees: { percent: 1.5, fixedEurCents: 25 } });
    const owner = await createUser({ email: "owner@example.com", verified: true, credits: 5000 });
    await recordUnrecordedOpeningBalances();
    await prisma.stripePayment.create({ data: { sessionId: "cs_test_1", userId: owner.user.id, packId: "starter", amountCents: 1000, credits: 1000, status: "completed", completedAt: new Date() } });
    await prisma.stripePayment.create({ data: { sessionId: "cs_test_2", userId: owner.user.id, packId: "starter", amountCents: 1000, credits: 1000, status: "pending" } });
    await fillContext(owner.auth);
    await defineObjective(owner.auth, { autonomy: "AUTO_WITHIN_BUDGET" });
    await runWorker();
    const s = (await api().get("/api/admin/economics?days=30").set(owner.auth).expect(200)).body;
    expect(s.cash).toEqual({ purchases: 1, collectedEurCents: 1000 });
    expect(s.paymentFeesEurCents).toBe(40); // 1.5% of €10.00 + €0.25
    expect(s.fixedCost).toEqual({ eurCents: 700, items: { render: 700 } });
    expect(s.excludedCosts.some((c: string) => /hosting|payment/.test(c))).toBe(false);
    const variable = s.variableCost.eurMicros / 10_000 + s.overheadCost.eurMicros / 10_000;
    expect(s.operatingContributionEurCents).toBeCloseTo(s.creditValueEurCents - variable - 700 - 40, 1);
    expect(s.notNetProfit).toMatch(/taxes and labour/);
  });

  it("is operator-only, and validates its parameters", async () => {
    const user = await createUser({ verified: true });
    await api().get("/api/admin/economics").set(user.auth).expect(403);
    const owner = await createUser({ email: "owner@example.com", verified: true });
    await api().get("/api/admin/economics?days=0").set(owner.auth).expect(400);
    await api().get("/api/admin/economics?margin=1").set(owner.auth).expect(400);
    await api().get("/api/admin/executions/nope/economics").set(owner.auth).expect(404);
  });
});
