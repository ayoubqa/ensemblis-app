// Monthly subscriptions end to end against a stateful fake Stripe (tests/stripeFake.ts): checkout in
// subscription mode, signed webhooks (real signature check), allowance grants that follow paid invoices only,
// expiry, mixed-source charges and refunds, cancellation, upgrades, downgrades, failed payments, entitlements.
// No network, no real keys, no real payments.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { config } from "../../src/config";
import { setStripeClientForTests } from "../../src/billing/stripe";
import { resetSubscriptionCachesForTests, sweepSubscriptions } from "../../src/billing/subscriptions";
import { entitlementsFor } from "../../src/billing/entitlements";
import { reconcileAllowances } from "../../src/lib/ledger";
import { debitWallet } from "../../src/lib/wallet";
import { failExecution } from "../../src/engine/lifecycle";
import { api, balance, createUser, defineObjective, fillContext, runWorker } from "../helpers";
import { FakeStripe, PRICE_IDS, WEBHOOK_SECRET, deliver, deliverAll } from "../stripeFake";

const saved = {
  secretKey: config.stripe.secretKey,
  webhookSecret: config.stripe.webhookSecret,
  subscriptions: { enabled: config.subscriptions.enabled, pastDueAccess: config.subscriptions.pastDueAccess },
  plans: config.subscriptions.plans.map((p) => ({ ...p })),
  perUser: config.maxTasksPerUserPerDay,
};
let fake: FakeStripe;

beforeEach(() => {
  fake = new FakeStripe();
  setStripeClientForTests(fake.client);
  resetSubscriptionCachesForTests();
  config.stripe.secretKey = "sk_test_fake_not_used";
  config.stripe.webhookSecret = WEBHOOK_SECRET;
  config.subscriptions.enabled = true;
  for (const p of config.subscriptions.plans) p.stripePriceId = PRICE_IDS[p.id as keyof typeof PRICE_IDS];
});
afterEach(() => {
  setStripeClientForTests(null);
  config.stripe.secretKey = saved.secretKey;
  config.stripe.webhookSecret = saved.webhookSecret;
  Object.assign(config.subscriptions, saved.subscriptions);
  config.subscriptions.plans.forEach((p, i) => Object.assign(p, saved.plans[i]));
  config.maxTasksPerUserPerDay = saved.perUser;
});

const sessionIdOf = (url: string) => url.split("/").pop()!;
const ledger = (userId: string) => prisma.transaction.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const grants = (userId: string) => prisma.transaction.findMany({ where: { userId, reason: "subscription_allowance" } });
const row = (userId: string) => prisma.subscription.findFirstOrThrow({ where: { walletUserId: userId }, orderBy: { createdAt: "desc" } });

function startCheckout(auth: Record<string, string>, planId: string, extra: Record<string, unknown> = {}) {
  return api().post("/api/billing/subscription/checkout").set(auth).send({ planId, ...extra });
}

/** Subscribes through the whole flow: checkout, the customer pays, Stripe's webhooks arrive. */
async function subscribe(auth: Record<string, string>, planId = "starter") {
  const r = await startCheckout(auth, planId).expect(200);
  const events = fake.completeCheckout(sessionIdOf(r.body.url));
  await deliverAll(events);
  return { events, stripeSubId: events[1].data.object.id as string };
}

/** A charge like an execution's, from the wallet, in its own transaction. */
const charge = (userId: string, amount: number, key?: string) =>
  prisma.$transaction((tx) => debitWallet(tx, { wallet: { walletUserId: userId, teamId: null, via: "self" }, actorUserId: userId, amountCents: amount, description: "test charge", idempotencyKey: key }));

describe("plans and checkout", () => {
  it("the public config lists the three plans from the server catalogue, with no Stripe IDs", async () => {
    const r = await api().get("/api/config").expect(200);
    expect(r.body.subscriptionsEnabled).toBe(true);
    expect(r.body.plans.map((p: { id: string; priceCents: number; monthlyCredits: number; available: boolean }) => [p.id, p.priceCents, p.monthlyCredits, p.available])).toEqual([
      ["starter", 2900, 3000, true],
      ["growth", 9900, 15000, true],
      ["business", 29900, 60000, true],
    ]);
    expect(JSON.stringify(r.body)).not.toMatch(/price_test|prod_/);
    config.subscriptions.enabled = false;
    const off = await api().get("/api/config").expect(200);
    expect(off.body.subscriptionsEnabled).toBe(false);
    expect(off.body.plans.every((p: { available: boolean }) => !p.available)).toBe(true);
  });

  it("checkout opens a subscription-mode session for the catalogue's Price, whatever the client sends, and grants nothing yet", async () => {
    const { auth, user } = await createUser({ credits: 1000 });
    const r = await startCheckout(auth, "growth", { priceCents: 1, stripePriceId: "price_evil", monthlyCredits: 999999, successUrl: "https://evil.example" }).expect(200);
    const create = fake.calls.find((c) => c.method === "checkout.sessions.create")!.args[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(create.mode).toBe("subscription");
    expect(create.line_items).toEqual([{ price: PRICE_IDS.growth, quantity: 1 }]);
    expect(create.success_url).toBe(`${config.appUrl}/usage?subscription=success`);
    expect(create.cancel_url).toBe(`${config.appUrl}/pricing?subscription=cancelled`);
    expect(create.metadata).toMatchObject({ kind: "subscription", walletUserId: user.id, planId: "growth" });
    expect(create.subscription_data.metadata).toEqual(create.metadata);
    expect(r.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    // A Stripe customer for this account, stored once.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).stripeCustomerId).toMatch(/^cus_/);
    // Nothing granted, nothing entitled: the plan starts when Stripe reports the first invoice paid.
    expect(await balance(user.id)).toBe(1000);
    expect((await row(user.id)).status).toBe("checkout_pending");
    expect((await entitlementsFor(prisma, user.id)).plan).toBeNull();
    // Visiting the success URL proves nothing either.
    const b = await api().get("/api/billing").set(auth).expect(200);
    expect(b.body.subscription).toMatchObject({ status: "checkout_pending", entitled: false, allowanceRemaining: 0 });
  });

  it("rejects unknown plans, signed-out visitors, guests and team members who don't own the wallet", async () => {
    const { auth } = await createUser();
    await startCheckout(auth, "enterprise").expect(400);
    await api().post("/api/billing/subscription/checkout").send({ planId: "starter" }).expect(401);
    const guest = await createUser({ isGuest: true });
    await startCheckout(guest.auth, "starter").expect(403);
    const owner = await createUser();
    const member = await createUser();
    const team = await prisma.team.create({ data: { name: "T", ownerId: owner.user.id } });
    await prisma.teamMember.create({ data: { teamId: team.id, userId: owner.user.id, role: "OWNER" } });
    await prisma.teamMember.create({ data: { teamId: team.id, userId: member.user.id } });
    expect((await startCheckout(member.auth, "starter").expect(403)).body.error).toMatch(/team owner/);
    expect(fake.calls.filter((c) => c.method === "checkout.sessions.create")).toHaveLength(0);
  });

  it("a repeated request reuses the open checkout; another plan closes the old one first", async () => {
    const { auth } = await createUser();
    const a = await startCheckout(auth, "starter").expect(200);
    const b = await startCheckout(auth, "starter").expect(200);
    expect(b.body.url).toBe(a.body.url);
    expect(fake.calls.filter((c) => c.method === "checkout.sessions.create")).toHaveLength(1);
    const c = await startCheckout(auth, "business").expect(200);
    expect(c.body.url).not.toBe(a.body.url);
    expect(fake.sessions.get(sessionIdOf(a.body.url))!.status).toBe("expired");
    expect(fake.calls.filter((x) => x.method === "customers.create")).toHaveLength(1);
  });

  it("refuses to sell a plan whose Stripe Price doesn't match the catalogue, and a second subscription", async () => {
    const { auth } = await createUser();
    fake.prices.get(PRICE_IDS.starter)!.unit_amount = 3900;
    await startCheckout(auth, "starter").expect(503);
    expect(fake.calls.filter((c) => c.method === "checkout.sessions.create")).toHaveLength(0);
    fake.prices.get(PRICE_IDS.starter)!.unit_amount = 2900;
    resetSubscriptionCachesForTests();
    await subscribe(auth, "starter");
    expect((await startCheckout(auth, "growth").expect(409)).body.error).toMatch(/already have the Starter plan/);
  });

  it("when Stripe can't be reached, checkout says so and leaves nothing half-done", async () => {
    const { auth, user } = await createUser();
    fake.failNext.add("checkout.sessions.create");
    expect((await startCheckout(auth, "starter").expect(503)).body.error).toMatch(/couldn't reach the payment provider/);
    expect((await row(user.id)).status).toBe("checkout_failed");
    await startCheckout(auth, "starter").expect(200); // a retry works
  });
});

describe("webhooks", () => {
  it("rejects a bad signature and changes nothing", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const r = await startCheckout(auth, "starter").expect(200);
    const events = fake.completeCheckout(sessionIdOf(r.body.url));
    for (const e of events) expect((await deliver(e, { secret: "whsec_wrong" })).status).toBe(400);
    expect(await balance(user.id)).toBe(0);
    expect((await row(user.id)).status).toBe("checkout_pending");
  });

  it("the first paid invoice grants the plan's allowance exactly once, however often Stripe delivers it", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const { events } = await subscribe(auth, "starter");
    await deliverAll(events); // the same events again
    const inv = events[2];
    await deliverAll([fake.event("invoice.paid", inv.data.object)]); // the same invoice, as a new event
    expect(await balance(user.id)).toBe(3000);
    expect(await grants(user.id)).toHaveLength(1);
    const s = await row(user.id);
    expect(s).toMatchObject({ status: "active", planId: "starter", allowanceCredits: 3000, allowanceGranted: 3000 });
    expect(s.allowancePeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(await reconcileAllowances()).toEqual([]);
    expect(await prisma.stripeEvent.count()).toBe(4);
  });

  it("an invoice marked paid with nothing charged (a trial or a 100% coupon set up in Stripe) grants nothing", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const r = await startCheckout(auth, "starter").expect(200);
    const events = fake.completeCheckout(sessionIdOf(r.body.url));
    Object.assign(fake.invoices.get(events[2].data.object.id)!, { amount_due: 0, amount_paid: 0 });
    await deliverAll(events);
    expect(await balance(user.id)).toBe(0);
    expect(await grants(user.id)).toHaveLength(0);
  });

  it("events arriving out of order still link the subscription and grant once", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const r = await startCheckout(auth, "growth").expect(200);
    const [completed, created, paid] = fake.completeCheckout(sessionIdOf(r.body.url));
    await deliverAll([paid, created, completed]);
    expect(await balance(user.id)).toBe(15000);
    expect(await row(user.id)).toMatchObject({ status: "active", planId: "growth", stripeSubscriptionId: created.data.object.id });
    expect(await grants(user.id)).toHaveLength(1);
  });

  it("a stale event can't overwrite newer state: the subscription is always re-read from Stripe", async () => {
    const { auth, user } = await createUser();
    const { events } = await subscribe(auth);
    await api().post("/api/billing/subscription/cancel").set(auth).expect(200);
    await deliverAll([fake.event("customer.subscription.created", events[1].data.object)]); // old payload, delivered late
    expect((await row(user.id)).cancelAtPeriodEnd).toBe(true);
  });

  it("a failure while processing answers 500 so Stripe retries, and the retry applies once", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const r = await startCheckout(auth, "starter").expect(200);
    const events = fake.completeCheckout(sessionIdOf(r.body.url));
    // Stripe unavailable while we re-read the invoice.
    fake.failNext.add("invoices.retrieve");
    expect((await deliver(events[2])).status).toBe(500);
    // The database failing on the next attempt.
    const sub = prisma.subscription as unknown as { findUnique: (...a: unknown[]) => Promise<unknown> };
    const original = sub.findUnique;
    let failed = false;
    sub.findUnique = (...a: unknown[]) => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error("simulated database error"));
      }
      return original.apply(prisma.subscription, a);
    };
    try {
      expect((await deliver(events[2])).status).toBe(500);
    } finally {
      sub.findUnique = original;
    }
    expect(await balance(user.id)).toBe(0);
    await deliverAll(events); // Stripe's retries
    expect(await balance(user.id)).toBe(3000);
    expect(await grants(user.id)).toHaveLength(1);
  });

  it("a one-off credit pack and a subscription never trigger each other's credits", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    // A subscription-mode session that carries a pack payment id grants no pack.
    const pack = await prisma.stripePayment.create({ data: { sessionId: "cs_pack_1", userId: user.id, packId: "starter", amountCents: 1000, credits: 1000 } });
    const r = await startCheckout(auth, "starter").expect(200);
    const [completed, created, paid] = fake.completeCheckout(sessionIdOf(r.body.url));
    completed.data.object.metadata.stripePaymentId = pack.id;
    await deliverAll([completed, created, paid]);
    expect((await prisma.stripePayment.findUniqueOrThrow({ where: { id: pack.id } })).status).toBe("pending");
    expect(await prisma.transaction.count({ where: { userId: user.id, type: "PURCHASE" } })).toBe(0);
    expect(await balance(user.id)).toBe(3000);
    // A paid credit pack ("payment" mode) credits its pack only, never an allowance.
    const sub = await row(user.id);
    const packSession = { id: "cs_pack_1", object: "checkout.session", mode: "payment", payment_status: "paid", amount_total: 1000, metadata: { stripePaymentId: pack.id, subscriptionRowId: sub.id } };
    await deliverAll([fake.event("checkout.session.completed", packSession)]);
    expect(await balance(user.id)).toBe(4000);
    expect((await row(user.id)).allowanceCredits).toBe(3000);
    expect(await grants(user.id)).toHaveLength(1);
    expect(await prisma.transaction.count({ where: { userId: user.id, type: "PURCHASE", allowanceCents: null } })).toBe(1);
  });
});

describe("credits: allowance, renewal, expiry, charges and refunds", () => {
  it("a paid renewal grants the next allowance once and expires what was left of the last one; other credits stay", async () => {
    const { auth, user } = await createUser({ credits: 500 }); // 500 credits that aren't plan credits
    const { stripeSubId } = await subscribe(auth, "starter");
    await charge(user.id, 1000); // all from the allowance
    expect((await row(user.id)).allowanceCredits).toBe(2000);
    const { events } = fake.renew(stripeSubId, { paid: true });
    await deliverAll(events);
    await deliverAll(events);
    expect(await grants(user.id)).toHaveLength(2);
    expect(await prisma.transaction.count({ where: { userId: user.id, reason: "allowance_expired" } })).toBe(1);
    expect(await balance(user.id)).toBe(500 + 3000); // 2,000 unused expired; 3,000 new
    expect((await row(user.id)).allowanceCredits).toBe(3000);
    expect(await reconcileAllowances()).toEqual([]);
  });

  it("an unpaid renewal grants nothing; when Stripe collects it later, the allowance follows", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const { stripeSubId } = await subscribe(auth, "starter");
    const { events, invoice } = fake.renew(stripeSubId, { paid: false });
    await deliverAll(events);
    expect(await grants(user.id)).toHaveLength(1);
    const s = await row(user.id);
    expect(s.status).toBe("past_due");
    const b = await api().get("/api/billing").set(auth).expect(200);
    expect(b.body.subscription.paymentProblem).toMatch(/Payment failed/);
    // The old period ends: its allowance expires; no new one has been paid for.
    await prisma.subscription.update({ where: { id: s.id }, data: { allowancePeriodEnd: new Date(Date.now() - 1000) } });
    await sweepSubscriptions();
    expect(await balance(user.id)).toBe(0);
    await deliverAll(fake.payInvoice(invoice.id));
    expect(await grants(user.id)).toHaveLength(2);
    expect(await balance(user.id)).toBe(3000);
    expect((await row(user.id)).status).toBe("active");
  });

  it("unused allowance expires at the end of its period, once; purchased and demo credits never do", async () => {
    const { auth, user } = await createUser({ credits: 700 });
    await subscribe(auth, "starter");
    await api().post("/api/billing/topup").set(auth).send({ amountCents: 1000 }).expect(200);
    const s = await row(user.id);
    await prisma.subscription.update({ where: { id: s.id }, data: { allowancePeriodEnd: new Date(Date.now() - 1000) } });
    expect((await sweepSubscriptions()).expired).toBe(3000);
    expect((await sweepSubscriptions()).expired).toBe(0);
    expect(await balance(user.id)).toBe(1700);
    expect(await reconcileAllowances()).toEqual([]);
  });

  it("an allowance whose period has ended can't be spent, even before the sweep runs", async () => {
    const { auth, user } = await createUser({ credits: 500 });
    await subscribe(auth, "starter");
    await prisma.subscription.updateMany({ where: { walletUserId: user.id }, data: { allowancePeriodEnd: new Date(Date.now() - 1000) } });
    // More than the other credits: refused (the expired plan credits don't count), and nothing changes.
    await expect(charge(user.id, 600)).rejects.toThrow(/Not enough credits/);
    expect(await balance(user.id)).toBe(3500);
    // Within the other credits: the charge expires the stale allowance first, then spends other credits only.
    await charge(user.id, 400);
    expect(await balance(user.id)).toBe(100);
    expect((await row(user.id)).allowanceCredits).toBe(0);
    const c = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id, type: "TASK_CHARGE" } });
    expect(c.allowanceCents).toBeNull();
    expect(await reconcileAllowances()).toEqual([]);
  });

  it("an execution charged from plan and other credits is refunded to the same sources", async () => {
    config.subscriptions.plans[0].monthlyCredits = 500;
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    await subscribe(auth, "starter");
    const { executionId } = await defineObjective(auth);
    await runWorker(); // planned, waiting for approval
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
    const ex = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
    expect(ex.costCents).toBeGreaterThan(500);
    const chargeRow = await prisma.transaction.findUniqueOrThrow({ where: { idempotencyKey: `charge:${executionId}` } });
    expect(chargeRow.allowanceCents).toBe(-500); // plan credits first
    expect((await row(user.id)).allowanceCredits).toBe(0);
    await failExecution(executionId, "test failure");
    expect((await row(user.id)).allowanceCredits).toBe(500);
    expect(await balance(user.id)).toBe(5500);
    const refund = await prisma.transaction.findFirstOrThrow({ where: { executionId, type: "REFUND" } });
    expect(refund).toMatchObject({ amountCents: ex.costCents, allowanceCents: 500 });
    expect(await reconcileAllowances()).toEqual([]);
    // Never more than once.
    expect(await failExecution(executionId, "again")).toBe(false);
    expect(await balance(user.id)).toBe(5500);
  });

  it("plan credits refunded after their period ended are refunded, then expire with that period", async () => {
    config.subscriptions.plans[0].monthlyCredits = 500;
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    await subscribe(auth, "starter");
    const { executionId } = await defineObjective(auth);
    await runWorker();
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
    const ex = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
    await prisma.subscription.updateMany({ where: { walletUserId: user.id }, data: { allowancePeriodEnd: new Date(Date.now() - 1000) } });
    await failExecution(executionId, "test failure");
    expect(await balance(user.id)).toBe(5000); // other credits back; the 500 plan credits expired with their period
    expect((await prisma.execution.findUniqueOrThrow({ where: { id: executionId } })).refundedCents).toBe(ex.costCents);
    const rows = await prisma.transaction.findMany({ where: { executionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(rows.map((r) => [r.type, r.reason])).toEqual([
      ["TASK_CHARGE", "execution_charge"],
      ["REFUND", "execution_failed"],
      ["ADJUSTMENT", "allowance_expired"],
    ]);
    expect(await reconcileAllowances()).toEqual([]);
  });

  it("concurrent charges can't overspend: plan credits are taken once, and the balance never goes negative", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    await subscribe(auth, "starter"); // 3,000, all plan credits
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => charge(user.id, 1000, `parallel:${i}`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await balance(user.id)).toBe(0);
    expect((await row(user.id)).allowanceCredits).toBe(0);
    expect(await reconcileAllowances()).toEqual([]);
    const sum = (await ledger(user.id)).reduce((n, t) => n + t.amountCents, 0);
    expect(sum).toBe(0);
  });
});

describe("lifecycle", () => {
  it("an abandoned checkout expires: nothing granted, and a new checkout can start", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const r = await startCheckout(auth, "starter").expect(200);
    const session = fake.sessions.get(sessionIdOf(r.body.url))!;
    session.status = "expired";
    await deliverAll([fake.event("checkout.session.expired", session)]);
    expect((await row(user.id)).status).toBe("checkout_expired");
    expect(await balance(user.id)).toBe(0);
    const again = await startCheckout(auth, "starter").expect(200);
    expect(again.body.url).not.toBe(r.body.url);
  });

  it("a first payment that fails leaves the subscription incomplete, unpaid and without credits", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const r = await startCheckout(auth, "starter").expect(200);
    await deliverAll(fake.completeCheckout(sessionIdOf(r.body.url), { paid: false }));
    expect((await row(user.id)).status).toBe("incomplete");
    expect(await balance(user.id)).toBe(0);
    expect((await entitlementsFor(prisma, user.id)).plan).toBeNull();
  });

  it("cancels at the end of the paid period: the plan and its credits last until then, then the plan ends", async () => {
    config.maxTasksPerUserPerDay = 2;
    const { auth, user } = await createUser({ credits: 0 });
    const { stripeSubId } = await subscribe(auth, "growth");
    const cancel = await api().post("/api/billing/subscription/cancel").set(auth).expect(200);
    expect(fake.calls.find((c) => c.method === "subscriptions.update")!.args[1]).toEqual({ cancel_at_period_end: true });
    expect(cancel.body.billing.subscription).toMatchObject({ cancelAtPeriodEnd: true, entitled: true, allowanceRemaining: 15000 });
    expect((await entitlementsFor(prisma, user.id)).runsPerDay).toBe(15);
    // Changed their mind.
    await api().post("/api/billing/subscription/resume").set(auth).expect(200);
    expect((await row(user.id)).cancelAtPeriodEnd).toBe(false);
    await api().post("/api/billing/subscription/cancel").set(auth).expect(200);
    // The period ends: Stripe ends the subscription.
    await deliverAll(fake.end(stripeSubId));
    const s = await row(user.id);
    expect(s.status).toBe("canceled");
    expect((await entitlementsFor(prisma, user.id)).runsPerDay).toBe(2);
    expect(await balance(user.id)).toBe(15000); // paid for: usable until the period end
    await prisma.subscription.update({ where: { id: s.id }, data: { allowancePeriodEnd: new Date(Date.now() - 1000) } });
    await sweepSubscriptions();
    expect(await balance(user.id)).toBe(0);
    // No refunds, no extra grants from any of this.
    expect(await grants(user.id)).toHaveLength(1);
    expect(await prisma.transaction.count({ where: { userId: user.id, type: "REFUND" } })).toBe(0);
  });

  it("an upgrade is charged pro rata and adds the difference for the rest of the period, never a second full allowance", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const { stripeSubId } = await subscribe(auth, "starter");
    const r = await api().post("/api/billing/subscription/change").set(auth).send({ planId: "growth" }).expect(200);
    expect(r.body.change).toBe("upgraded");
    const update = fake.calls.find((c) => c.method === "subscriptions.update")!.args[1] as Record<string, unknown>;
    expect(update).toMatchObject({ proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" });
    await deliverAll(fake.upgradeEvents);
    await deliverAll(fake.upgradeEvents);
    const s = await row(user.id);
    expect(s.planId).toBe("growth");
    const extra = s.allowanceGranted - 3000;
    expect(extra).toBeGreaterThan(11_900); // ~12,000: almost the whole period was left
    expect(extra).toBeLessThanOrEqual(12_000);
    expect(await balance(user.id)).toBe(3000 + extra);
    expect(await grants(user.id)).toHaveLength(2);
    // The next renewal is the Growth allowance.
    await deliverAll(fake.renew(stripeSubId, { paid: true }).events);
    expect((await row(user.id)).allowanceCredits).toBe(15000);
    expect(await reconcileAllowances()).toEqual([]);
  });

  it("an upgrade whose payment fails changes nothing", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    await subscribe(auth, "starter");
    fake.cardDeclines = true;
    expect((await api().post("/api/billing/subscription/change").set(auth).send({ planId: "business" }).expect(402)).body.error).toMatch(/couldn't be charged/);
    expect(await row(user.id)).toMatchObject({ planId: "starter", allowanceCredits: 3000 });
    expect(await grants(user.id)).toHaveLength(1);
  });

  it("a downgrade starts at the next renewal; it can be undone until then", async () => {
    const { auth, user } = await createUser({ credits: 0 });
    const { stripeSubId } = await subscribe(auth, "business");
    const r = await api().post("/api/billing/subscription/change").set(auth).send({ planId: "starter" }).expect(200);
    expect(r.body.change).toBe("downgrade_scheduled");
    expect(r.body.billing.subscription).toMatchObject({ planId: "business", nextPlanId: "starter", allowanceRemaining: 60000 });
    expect(fake.calls.filter((c) => c.method === "subscriptions.update").at(-1)!.args[1]).toMatchObject({ proration_behavior: "none" });
    // Undo, then downgrade again.
    expect((await api().post("/api/billing/subscription/change").set(auth).send({ planId: "business" }).expect(200)).body.change).toBe("scheduled_change_cancelled");
    expect((await row(user.id)).nextPlanId).toBeNull();
    await api().post("/api/billing/subscription/change").set(auth).send({ planId: "starter" }).expect(200);
    await deliverAll(fake.renew(stripeSubId, { paid: true }).events);
    expect(await row(user.id)).toMatchObject({ planId: "starter", nextPlanId: null, allowanceCredits: 3000 });
    expect(await balance(user.id)).toBe(3000); // the unused Business credits expired with their period
  });

  it("limits follow the plan only while it is paid up; unknown plans get the prepaid limits", async () => {
    config.maxTasksPerUserPerDay = 2;
    const { auth, user } = await createUser();
    const { stripeSubId } = await subscribe(auth, "business");
    expect((await entitlementsFor(prisma, user.id)).runsPerDay).toBe(40);
    await deliverAll(fake.renew(stripeSubId, { paid: false }).events); // past_due
    expect((await entitlementsFor(prisma, user.id)).runsPerDay).toBe(40); // SUBSCRIPTION_PAST_DUE_ACCESS=keep
    config.subscriptions.pastDueAccess = "revoke";
    expect((await entitlementsFor(prisma, user.id)).runsPerDay).toBe(2);
    config.subscriptions.pastDueAccess = "keep";
    await prisma.subscription.updateMany({ where: { walletUserId: user.id }, data: { planId: "legacy-unknown", status: "active" } });
    expect((await entitlementsFor(prisma, user.id)).plan).toBeNull();
    expect((await entitlementsFor(prisma, user.id)).runsPerDay).toBe(2);
  });

  it("the plan's daily limit is enforced when an execution starts", async () => {
    config.maxTasksPerUserPerDay = 1;
    const { auth, user } = await createUser({ credits: 20000 });
    await fillContext(auth);
    const startOne = async () => {
      await defineObjective(auth);
      await runWorker();
      const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
      return api().post(`/api/approvals/${a.id}/approve`).set(auth).send({});
    };
    expect((await startOne()).status).toBe(200);
    expect((await startOne()).status).toBe(429); // prepaid: 1 a day
    config.subscriptions.plans[0].runsPerDay = 3;
    await subscribe(auth, "starter");
    expect((await startOne()).status).toBe(200); // the plan allows 3
    expect(await prisma.transaction.count({ where: { userId: user.id, type: "TASK_CHARGE" } })).toBe(2);
  });

  it("opens the Customer Portal for the wallet owner with a fixed return URL", async () => {
    const { auth } = await createUser();
    expect((await api().post("/api/billing/subscription/portal").set(auth).expect(404)).body.error).toMatch(/no billing account/);
    await subscribe(auth, "starter");
    const r = await api().post("/api/billing/subscription/portal").set(auth).expect(200);
    expect(r.body.url).toMatch(/^https:\/\/billing\.stripe\.test\//);
    const args = fake.calls.find((c) => c.method === "billingPortal.sessions.create")!.args[0] as Record<string, unknown>;
    expect(args.return_url).toBe(`${config.appUrl}/usage?portal=return`);
  });

  it("billing shows the owner their plan and the credit split; a team member sees the split only", async () => {
    const { auth, user } = await createUser({ credits: 1000 });
    await subscribe(auth, "growth");
    const b = (await api().get("/api/billing").set(auth).expect(200)).body;
    expect(b.balanceCents).toBe(16000);
    expect(b.credits).toEqual({ planCreditsCents: 15000, otherCreditsCents: 1000 });
    expect(b.subscription).toMatchObject({ planId: "growth", planName: "Growth", status: "active", entitled: true, allowanceGranted: 15000, allowanceRemaining: 15000, cancelAtPeriodEnd: false });
    expect(b.subscription.currentPeriodEnd).toBeTruthy();
    const member = await createUser();
    const team = await prisma.team.create({ data: { name: "T", ownerId: user.id } });
    await prisma.teamMember.create({ data: { teamId: team.id, userId: user.id, role: "OWNER" } });
    await prisma.teamMember.create({ data: { teamId: team.id, userId: member.user.id } });
    const m = (await api().get("/api/billing").set(member.auth).expect(200)).body;
    expect(m.subscription).toBeNull();
    expect(m.credits).toEqual({ planCreditsCents: 15000, otherCreditsCents: 1000 });
    await api().post("/api/billing/subscription/cancel").set(member.auth).expect(403);
  });
});
