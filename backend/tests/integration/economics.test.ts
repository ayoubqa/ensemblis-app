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
    expect(r.contributionEurCents).toBeCloseTo(ex.costCents - costCents, 2);
    expect(r.grossMarginPct).toBeCloseTo(((ex.costCents - costCents) / ex.costCents) * 100, 0);
    expect(r.excludedCosts.length).toBeGreaterThan(0);

    const summary = (await api().get("/api/admin/economics?days=7&margin=0.8").set(owner.auth).expect(200)).body;
    expect(summary.executions).toMatchObject({ total: 1, completed: 1 });
    expect(summary.credits).toMatchObject({ charged: ex.costCents, net: ex.costCents, perCompletedExecution: ex.costCents });
    expect(summary.costPerCompletedExecutionEurMicros).toBe(Math.round(totalUsdMicros * 0.9));
    expect(summary.pricing).toMatchObject({ configuredModels: ["mock"], fxCurrencies: ["USD"], problem: null });

    const overview = (await api().get("/api/admin/overview").set(owner.auth).expect(200)).body;
    expect(overview.ledger.mismatches).toBe(0);
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
