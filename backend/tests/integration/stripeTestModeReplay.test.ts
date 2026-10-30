// Replays the Stripe test-mode run of 2026-10-30 through the app (fixtures/stripeTestMode20261030.ts).
// Every Stripe call the app makes is answered with the response Stripe actually gave in that run, and its
// parameters are compared with what was sent to Stripe then. Webhooks go through the real signature check.
// The event envelopes are built here: that run had no webhook endpoint. The objects inside them are real.

import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { config } from "../../src/config";
import { setStripeClientForTests } from "../../src/billing/stripe";
import { resetSubscriptionCachesForTests } from "../../src/billing/subscriptions";
import { checkTestMode } from "../../src/billing/stripeTestMode";
import { reconcileAllowances } from "../../src/lib/ledger";
import { api, balance, createUser } from "../helpers";
import { WEBHOOK_SECRET, deliverAll } from "../stripeFake";
import * as run from "../fixtures/stripeTestMode20261030";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

/** A Stripe client that answers with the run's real responses. */
class Replay {
  calls: { method: string; args: any[] }[] = [];
  subs = new Map<string, Obj>();
  invoices = new Map<string, Obj>();
  /** Stripe's real answers to subscriptions.update, in the order the run made them. */
  updates: Obj[] = [];
  customer: Obj | null = null;
  /** Fixture placeholder → the id the test created. */
  ids: Record<string, string> = {};
  client: Stripe;

  constructor() {
    const real = new Stripe("sk_test_fake_not_used");
    const c = real as unknown as Obj;
    const rec = (method: string, fn: (...a: any[]) => unknown) => async (...args: any[]) => {
      this.calls.push({ method, args });
      return this.swap(await fn(...args));
    };
    const need = <T>(v: T | undefined, what: string): T => {
      if (v === undefined) throw new Error(`replay has no ${what}`);
      return v;
    };
    c.accounts = { retrieve: rec("accounts.retrieve", () => ({ id: "acct_1UVzu9JxdXxCrKwI", settings: { dashboard: { display_name: "Ensemblis" } } })) };
    c.prices = { retrieve: rec("prices.retrieve", (id: string) => need((run.prices as Obj)[id], `price ${id}`)) };
    c.customers = { create: rec("customers.create", () => need(this.customer ?? undefined, "customer")) };
    c.checkout = { sessions: { create: rec("checkout.sessions.create", () => run.checkoutSession), expire: rec("checkout.sessions.expire", () => ({ ...run.checkoutSession, status: "expired" })) } };
    c.subscriptions = {
      retrieve: rec("subscriptions.retrieve", (id: string) => need(this.subs.get(id), `subscription ${id}`)),
      update: rec("subscriptions.update", (id: string) => {
        const next = need(this.updates.shift(), "queued subscription update");
        this.subs.set(id, next);
        return next;
      }),
    };
    c.invoices = { retrieve: rec("invoices.retrieve", (id: string) => need(this.invoices.get(id), `invoice ${id}`)) };
    c.webhookEndpoints = { list: rec("webhookEndpoints.list", () => ({ object: "list", data: [], has_more: false })) };
    c.billingPortal = {
      configurations: {
        retrieve: rec("billingPortal.configurations.retrieve", () => run.portalConfiguration),
        list: rec("billingPortal.configurations.list", () => ({ object: "list", data: [run.portalConfiguration], has_more: false })),
      },
      sessions: { create: rec("billingPortal.sessions.create", () => ({ id: "bps_1UWIm3JxdXxCrKwIYDYTR2D4", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/replayed" })) },
    };
    this.client = real;
  }

  swap<T>(o: T): T {
    if (o == null) return o;
    let s = JSON.stringify(o);
    for (const [from, to] of Object.entries(this.ids)) s = s.replace(new RegExp(`\\b${from}\\b`, "g"), to);
    return JSON.parse(s);
  }

  last(method: string) {
    const c = [...this.calls].reverse().find((x) => x.method === method);
    if (!c) throw new Error(`no ${method} call`);
    return c.args;
  }
}

let replay: Replay;
let n = 0;
/** An event envelope as Stripe sends it (API version of the account's events in that run). */
const ev = (type: string, object: Obj) => ({ id: `evt_replay_${++n}`, object: "event", api_version: "2026-09-30.endive", created: Math.floor(run.RUN_TIME.getTime() / 1000), livemode: false, type, data: { object: replay.swap(object) } });

const saved = {
  secretKey: config.stripe.secretKey,
  webhookSecret: config.stripe.webhookSecret,
  enabled: config.subscriptions.enabled,
  portal: config.subscriptions.portalConfigurationId,
  appUrl: config.appUrl,
  plans: config.subscriptions.plans.map((p) => ({ ...p })),
};
beforeEach(() => {
  // The run's periods are real dates: hold the app's clock at the moment of the run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(run.RUN_TIME);
  replay = new Replay();
  setStripeClientForTests(replay.client);
  resetSubscriptionCachesForTests();
  config.stripe.secretKey = "sk_test_fake_not_used";
  config.stripe.webhookSecret = WEBHOOK_SECRET;
  config.subscriptions.enabled = true;
  config.subscriptions.portalConfigurationId = run.portalConfiguration.id;
  (config as { appUrl: string }).appUrl = "http://localhost:3000";
  for (const p of config.subscriptions.plans) Object.assign(p, { stripePriceId: run.REAL_PRICE_IDS[p.id as keyof typeof run.REAL_PRICE_IDS], stripeProductId: "" });
});
afterEach(() => {
  vi.useRealTimers();
  setStripeClientForTests(null);
  config.stripe.secretKey = saved.secretKey;
  config.stripe.webhookSecret = saved.webhookSecret;
  config.subscriptions.enabled = saved.enabled;
  config.subscriptions.portalConfigurationId = saved.portal;
  (config as { appUrl: string }).appUrl = saved.appUrl;
  config.subscriptions.plans.forEach((p, i) => Object.assign(p, saved.plans[i]));
});

const row = (userId: string) => prisma.subscription.findFirstOrThrow({ where: { walletUserId: userId }, orderBy: { createdAt: "desc" } });
const grants = (userId: string) => prisma.transaction.findMany({ where: { userId, reason: "subscription_allowance" }, orderBy: { createdAt: "asc" } });

/** Starts the app's checkout for `customer`; the subscription row it creates stands for the run's fixture row. */
async function checkout(planId: string, customer: Obj, fixture: { row: string; wallet: string }) {
  const { auth, user } = await createUser({ credits: 0 });
  replay.customer = customer;
  const r = await api().post("/api/billing/subscription/checkout").set(auth).send({ planId }).expect(200);
  const created = await row(user.id);
  replay.ids = { [fixture.row]: created.id, [fixture.wallet]: user.id };
  return { auth, user, url: r.body.url as string, rowId: created.id };
}

describe("Stripe test-mode run of 2026-10-30, replayed through the app", () => {
  it("check: the run's prices and portal configuration pass the tool's checks", async () => {
    const findings = await checkTestMode(replay.client);
    expect(findings.filter((f) => f.level === "fail")).toEqual([]);
    const ok = findings.filter((f) => f.level === "ok").map((f) => f.what);
    expect(ok).toEqual(
      expect.arrayContaining([
        `Starter: ${run.REAL_PRICE_IDS.starter}, €29.00 a month, product prod_VXNMzvj2CHfuuc`,
        `Growth: ${run.REAL_PRICE_IDS.growth}, €99.00 a month, product prod_VXNNeqOkk2DZVn`,
        `Business: ${run.REAL_PRICE_IDS.business}, €299.00 a month, product prod_VXNNMSOGYSjBiH`,
        `portal configuration ${run.portalConfiguration.id} matches the app's policy`,
      ])
    );
  });

  it("J1, J6, J8: checkout, first invoice, upgrade, downgrade and keep, as Stripe answered them", async () => {
    const { auth, user, url, rowId } = await checkout("starter", run.j1Customer, { row: "fixture_row_j1", wallet: "fixture_wallet_j1" });
    expect(url).toBe(run.checkoutSession.url);
    // The app sends what the run sent to Stripe (and Stripe accepted).
    const [session, sessionOpts] = replay.last("checkout.sessions.create");
    const metadata = { kind: "subscription", subscriptionRowId: rowId, walletUserId: user.id, planId: "starter" };
    expect(session).toEqual({
      mode: "subscription",
      customer: run.j1Customer.id,
      client_reference_id: rowId,
      line_items: [{ price: run.REAL_PRICE_IDS.starter, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: "http://localhost:3000/usage?subscription=success",
      cancel_url: "http://localhost:3000/pricing?subscription=cancelled",
      expires_at: Math.floor(run.RUN_TIME.getTime() / 1000) + 3600,
    });
    expect(sessionOpts).toEqual({ idempotencyKey: `subscription_checkout_${rowId}` });
    expect(await balance(user.id)).toBe(0); // nothing before Stripe says it is paid

    replay.subs.set(run.j1.created.id, run.j1.created);
    replay.invoices.set(run.j1.firstInvoice.id, run.j1.firstInvoice);
    replay.invoices.set(run.j1.upgradeInvoice.id, run.j1.upgradeInvoice);
    const firstPaid = ev("invoice.paid", run.j1.firstInvoice);
    await deliverAll([ev("customer.subscription.created", run.j1.created), firstPaid]);
    expect(await balance(user.id)).toBe(3000);
    expect(await row(user.id)).toMatchObject({
      stripeSubscriptionId: run.j1.created.id,
      status: "active",
      planId: "starter",
      allowanceCredits: 3000,
      allowancePeriodStart: new Date(1793377800 * 1000),
      allowancePeriodEnd: new Date(1796056200 * 1000),
      currentPeriodEnd: new Date(1796056200 * 1000),
    });

    // J6: upgrade to Growth. Stripe charged €70.00 (−€29.00 unused Starter, +€99.00 Growth), whole period left.
    replay.updates.push(run.j1.upgraded);
    await api().post("/api/billing/subscription/change").set(auth).send({ planId: "growth" }).expect(200);
    expect(replay.last("subscriptions.update").slice(0, 2)).toEqual([
      run.j1.created.id,
      { items: [{ id: "si_VXNQHAgJlXbKoo", price: run.REAL_PRICE_IDS.growth }], proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" },
    ]);
    await deliverAll([ev("customer.subscription.updated", run.j1.upgraded), ev("invoice.paid", run.j1.upgradeInvoice)]);
    expect(await balance(user.id)).toBe(15000); // + (15,000 − 3,000) × the whole period
    expect((await grants(user.id)).map((g) => [g.amountCents, g.idempotencyKey])).toEqual([
      [3000, `allowance:${run.j1.firstInvoice.id}`],
      [12000, `allowance:${run.j1.upgradeInvoice.id}`],
    ]);
    expect(await row(user.id)).toMatchObject({ planId: "growth", nextPlanId: null, allowanceCredits: 15000 });

    // J8: downgrade to Starter from the next renewal. Stripe: price changed, no invoice.
    replay.updates.push(run.j1.downgraded);
    await api().post("/api/billing/subscription/change").set(auth).send({ planId: "starter" }).expect(200);
    expect(replay.last("subscriptions.update")[1]).toEqual({ items: [{ id: "si_VXNQHAgJlXbKoo", price: run.REAL_PRICE_IDS.starter }], proration_behavior: "none" });
    await deliverAll([ev("customer.subscription.updated", run.j1.downgraded)]);
    expect(await row(user.id)).toMatchObject({ planId: "growth", nextPlanId: "starter", allowanceCredits: 15000 });

    // Keep Growth: the price goes back, again without proration.
    replay.updates.push(run.j1.kept);
    await api().post("/api/billing/subscription/change").set(auth).send({ planId: "growth" }).expect(200);
    expect(replay.last("subscriptions.update")[1]).toEqual({ items: [{ id: "si_VXNQHAgJlXbKoo", price: run.REAL_PRICE_IDS.growth }], proration_behavior: "none" });
    await deliverAll([ev("customer.subscription.updated", run.j1.kept)]);
    expect(await row(user.id)).toMatchObject({ planId: "growth", nextPlanId: null });

    // J2: Stripe redelivers the first invoice.paid, and a second event about the same invoice arrives.
    await deliverAll([firstPaid, ev("invoice.paid", run.j1.firstInvoice)]);
    expect(await grants(user.id)).toHaveLength(2);
    expect(await balance(user.id)).toBe(15000);
    expect(await reconcileAllowances()).toEqual([]);
  });

  it("J4: a first payment that fails leaves the plan incomplete, unpaid and without credits", async () => {
    const { auth, user } = await checkout("starter", { id: run.j4.customer, object: "customer" }, { row: "fixture_row_j4", wallet: "fixture_wallet_j4" });
    replay.subs.set(run.j4.created.id, run.j4.created);
    replay.invoices.set(run.j4.invoice.id, run.j4.invoice);
    await deliverAll([ev("customer.subscription.created", run.j4.created), ev("invoice.payment_failed", run.j4.invoice)]);
    expect(await row(user.id)).toMatchObject({ status: "incomplete", lastPaymentError: "Payment failed (attempt 1)" });
    expect(await balance(user.id)).toBe(0);
    expect(await grants(user.id)).toHaveLength(0);
    const billing = (await api().get("/api/billing").set(auth).expect(200)).body;
    expect(billing.subscription).toMatchObject({ status: "incomplete", paymentProblem: "Payment failed (attempt 1)" });
  });

  it("J5: cancel at period end and keep; Stripe's early canceled_at doesn't end the plan", async () => {
    const { auth, user } = await checkout("starter", { id: run.j5.customer, object: "customer" }, { row: "fixture_row_j7", wallet: "fixture_wallet_j7" });
    replay.subs.set(run.j5.active.id, run.j5.active);
    await deliverAll([ev("customer.subscription.created", run.j5.active)]);

    replay.updates.push(run.j5.cancelled);
    await api().post("/api/billing/subscription/cancel").set(auth).expect(200);
    expect(replay.last("subscriptions.update")[1]).toEqual({ cancel_at_period_end: true });
    expect(await row(user.id)).toMatchObject({ status: "active", cancelAtPeriodEnd: true, endedAt: null });
    const billing = (await api().get("/api/billing").set(auth).expect(200)).body;
    expect(billing.subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: true, endedAt: null });

    replay.updates.push(run.j5.kept);
    await api().post("/api/billing/subscription/resume").set(auth).expect(200);
    expect(replay.last("subscriptions.update")[1]).toEqual({ cancel_at_period_end: false });
    expect(await row(user.id)).toMatchObject({ status: "active", cancelAtPeriodEnd: false, canceledAt: null });
  });

  it("J7: a €0 'paid' first invoice grants nothing; a declined upgrade is a 402 and changes nothing", async () => {
    const { auth, user } = await checkout("starter", { id: run.j7.customer, object: "customer" }, { row: "fixture_row_j7b", wallet: "fixture_wallet_j7b" });
    replay.subs.set(run.j7.active.id, run.j7.active);
    replay.invoices.set(run.j7.zeroInvoice.id, run.j7.zeroInvoice);
    replay.invoices.set(run.j7.upgradeInvoice.id, run.j7.upgradeInvoice);
    await deliverAll([ev("customer.subscription.created", run.j7.active), ev("invoice.paid", run.j7.zeroInvoice)]);
    expect(await row(user.id)).toMatchObject({ status: "active", planId: "starter", allowanceCredits: 0 });
    expect(await grants(user.id)).toHaveLength(0);

    // Stripe answered the upgrade with 200 and pending_update set; the card was declined.
    replay.updates.push(run.j7.upgradeDeclined);
    const r = await api().post("/api/billing/subscription/change").set(auth).send({ planId: "growth" }).expect(402);
    expect(r.body.error).toMatch(/couldn't be charged for the upgrade to Growth, so your plan hasn't changed/);
    expect(replay.last("subscriptions.update")[1]).toEqual({ items: [{ id: "si_VXNUPzaIO6w9V8", price: run.REAL_PRICE_IDS.growth }], proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" });
    await deliverAll([ev("customer.subscription.updated", run.j7.upgradeDeclined), ev("invoice.payment_failed", run.j7.upgradeInvoice)]);
    expect(await row(user.id)).toMatchObject({ status: "active", planId: "starter", nextPlanId: null, allowanceCredits: 0 });
    expect(await balance(user.id)).toBe(0);
  });

  it("an invoice in the newer layout whose first plan line is a proration grants the period line's plan", async () => {
    // Composed from the run's real lines: a renewal that also carries prorations, as when a plan is changed with
    // create_prorations in the Dashboard. Proration flags sit under parent.subscription_item_details here.
    const { user } = await checkout("starter", run.j1Customer, { row: "fixture_row_j1", wallet: "fixture_wallet_j1" });
    replay.subs.set(run.j1.created.id, run.j1.created);
    replay.invoices.set(run.j1.firstInvoice.id, run.j1.firstInvoice);
    await deliverAll([ev("customer.subscription.created", run.j1.created), ev("invoice.paid", run.j1.firstInvoice)]);
    const [unusedStarter] = run.j1.upgradeInvoice.lines.data;
    const growthPeriod = { ...run.j1.firstInvoice.lines.data[0], id: "il_composed_growth", amount: 9900, pricing: { type: "price_details", price_details: { price: run.REAL_PRICE_IDS.growth, product: "prod_VXNNeqOkk2DZVn" } }, period: { start: 1796056200, end: 1798648200 } };
    const renewal = { ...run.j1.firstInvoice, id: "in_composed_renewal", billing_reason: "subscription_cycle", amount_due: 7000, amount_paid: 7000, total: 7000, lines: { object: "list", data: [unusedStarter, growthPeriod], has_more: false } };
    replay.subs.set(run.j1.created.id, run.j1.kept);
    replay.invoices.set(renewal.id, renewal);
    await deliverAll([ev("invoice.paid", renewal)]);
    expect(await row(user.id)).toMatchObject({ planId: "growth", allowanceCredits: 15000, allowancePeriodStart: new Date(1796056200 * 1000) });
  });
});
