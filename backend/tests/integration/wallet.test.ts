// Regression tests for the money paths that must not change: atomic debits,
// single refunds, Stripe webhook idempotency, legacy task refunds.
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { prisma } from "../../src/db";
import { creditWallet, debitWallet, resolveWallet } from "../../src/lib/wallet";
import { fulfillCheckoutSession } from "../../src/billing/stripe";
import { failAndRefund, sweepLegacyRuns } from "../../src/legacy/tasks";
import { refundExecution } from "../../src/engine/billing";
import { api, balance, createUser } from "../helpers";

describe("wallet", () => {
  it("parallel debits never overdraw (conditional decrement)", async () => {
    const { user } = await createUser({ credits: 1000 });
    const wallet = await resolveWallet(user.id);
    const attempts = Array.from({ length: 8 }, () =>
      prisma.$transaction((tx) => debitWallet(tx, { wallet, actorUserId: user.id, amountCents: 300, description: "x" })).then(
        () => "ok",
        (e) => (e.status === 402 ? "402" : "other")
      )
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok")).toHaveLength(3);
    expect(results.filter((r) => r === "402")).toHaveLength(5);
    expect(await balance(user.id)).toBe(100);
    expect(await prisma.transaction.count({ where: { userId: user.id, type: "TASK_CHARGE" } })).toBe(3);
  });

  it("execution refunds are capped at what was charged", async () => {
    const { user } = await createUser({ credits: 0 });
    const org = await prisma.organization.create({ data: { ownerId: user.id, name: "Org" } });
    const objective = await prisma.objective.create({ data: { orgId: org.id, title: "t", statement: "s", budgetCents: 1000 } });
    const ex = await prisma.execution.create({ data: { orgId: org.id, objectiveId: objective.id, costCents: 500, walletUserId: user.id, chargedAt: new Date(), status: "RUNNING" } });
    const r = await Promise.all([1, 2, 3].map(() => prisma.$transaction((tx) => refundExecution(tx, ex.id, 400, "test"))));
    expect(r.reduce((a, b) => a + b, 0)).toBe(500);
    expect(await balance(user.id)).toBe(500);
  });

  it("Stripe: a paid session credits the wallet exactly once, however often the webhook is delivered", async () => {
    const { user } = await createUser({ credits: 0 });
    const payment = await prisma.stripePayment.create({ data: { sessionId: "cs_test_1", userId: user.id, packId: "starter", amountCents: 1000, credits: 1000 } });
    const session = { id: "cs_test_1", payment_status: "paid", amount_total: 1000, metadata: { stripePaymentId: payment.id } } as unknown as Stripe.Checkout.Session;
    const results = await Promise.all([fulfillCheckoutSession(session), fulfillCheckoutSession(session), fulfillCheckoutSession(session)]);
    expect(results.filter((r) => r === "credited")).toHaveLength(1);
    expect(results.filter((r) => r === "already")).toHaveLength(2);
    expect(await balance(user.id)).toBe(1000);
    expect(await fulfillCheckoutSession({ ...session, payment_status: "unpaid" } as Stripe.Checkout.Session)).toBe("ignored");
  });

  it("legacy tasks still running at deploy time are failed and refunded once", async () => {
    const { user } = await createUser({ credits: 0 });
    const task = await prisma.task.create({ data: { userId: user.id, title: "Old", description: "d", status: "RUNNING", costCents: 1500, walletUserId: user.id } });
    await prisma.$transaction((tx) => creditWallet(tx, { walletUserId: user.id, actorUserId: null, type: "TOP_UP", amountCents: 1, description: "seed" }));
    expect(await sweepLegacyRuns()).toBe(1);
    expect(await failAndRefund(task.id, "again")).toBe(false);
    expect(await balance(user.id)).toBe(1501);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("FAILED");
  });

  it("usage summary reports execution spend per objective", async () => {
    const { auth } = await createUser();
    const r = await api().get("/api/billing").set(auth).expect(200);
    expect(r.body).toMatchObject({ balanceCents: 5000, monthSpendCents: 0, usage: { monthExecutions: 0, byObjective: [] } });
  });
});
