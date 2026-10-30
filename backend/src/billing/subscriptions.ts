// Monthly subscriptions through Stripe Billing: checkout, the lifecycle Stripe reports by webhook, the monthly
// allowance, cancellation, plan changes and the Customer Portal.
//
// What is authoritative:
//   - Stripe, for whether a subscription exists, is paid and when it renews. Every webhook re-reads the object
//     from the API before using it, so a late, duplicated or out-of-order event can't apply stale data; reads
//     carry their time (Subscription.stripeSyncedAt) and an older read never overwrites a newer one.
//   - Paid invoices, for credits. The allowance for a period is granted only on invoice.paid, once per invoice
//     (ledger idempotency key "allowance:<invoiceId>"): never on checkout creation, a success-page visit, a
//     subscription update, a retry or a restart.
//   - The plan catalogue (billing/plans.ts), for prices and allowances. The client only names a plan id.
//
// Policies (DEPLOYMENT.md, "Subscriptions"):
//   - First period: the allowance is granted when the first invoice is paid. Renewal: the next allowance when
//     the renewal invoice is paid; the previous period's unused allowance expires then (or at its period end).
//     An invoice "paid" with nothing charged (a trial or 100% coupon set up in Stripe) grants nothing.
//   - Failed renewal: no allowance; Stripe retries. Purchased and other credits stay usable.
//   - Cancel: at the end of the paid period (cancel_at_period_end). The allowance already paid for stays usable
//     until that period ends. Immediate cancellation is not offered in the app.
//   - Upgrade: immediate. Stripe charges the prorated difference; once that invoice is paid the allowance grows by
//     the difference in monthly credits × the share of the period left. Never a second full allowance.
//   - Downgrade: from the next renewal. The current period's plan and allowance are kept until then.

import type Stripe from "stripe";
import type { Subscription as SubscriptionRow } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { withLock } from "../lib/usageLimits";
import { creditWallet, expireAllowance, lockWallet, resolveWallet, spendableBalance } from "../lib/wallet";
import { formatCredits } from "./credits";
import { entitledStatuses, entitlementsForPlan } from "./entitlements";
import { planAvailable, planById, planByPriceId, subscriptionsAvailable, type Plan } from "./plans";
import { stripeClient } from "./stripeClient";

/** Stripe statuses of a subscription that still exists (a wallet may have at most one). */
export const LIVE_STATUSES = ["incomplete", "trialing", "active", "past_due", "unpaid", "paused"];
/** Checkout links expire after this long (Stripe's minimum is 30 minutes). */
const CHECKOUT_TTL_S = 60 * 60;
/** How long a verified Stripe Price is trusted before it is checked again. */
const PRICE_CHECK_TTL_MS = 10 * 60_000;

const ts = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

// ------------------------------------------------------------------ Stripe object shapes
// The SDK's pinned API version puts these at the top level; newer webhook API versions moved some of them.
// Objects are re-read through the SDK before use, so only the pinned shape should arrive — the fallbacks keep a
// newer one from silently reading as "missing".

type AnySub = Stripe.Subscription & { items: { data: (Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number })[] } };
type AnyInvoice = Stripe.Invoice & { parent?: { subscription_details?: { subscription?: string | { id: string } } } };
type AnyLine = Stripe.InvoiceLineItem & { pricing?: { price_details?: { price?: string } } };

function subPeriod(s: AnySub): { start: Date | null; end: Date | null } {
  const item = s.items?.data?.[0];
  return { start: ts(s.current_period_start ?? item?.current_period_start), end: ts(s.current_period_end ?? item?.current_period_end) };
}
function subPriceId(s: AnySub): string | null {
  return s.items?.data?.[0]?.price?.id ?? null;
}
function invoiceSubscriptionId(inv: AnyInvoice): string | null {
  return idOf(inv.subscription as string | Stripe.Subscription | null) ?? idOf(inv.parent?.subscription_details?.subscription);
}
function linePriceId(l: AnyLine): string | null {
  return l.price?.id ?? l.pricing?.price_details?.price ?? null;
}

// ------------------------------------------------------------------ checkout

async function assertWalletOwner(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, isGuest: true, stripeCustomerId: true } });
  if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  if (user.isGuest) throw new HttpError(403, "Create a free account to choose a plan.");
  const wallet = await resolveWallet(userId);
  if (wallet.walletUserId !== userId) throw new HttpError(403, "Only your team owner can manage the plan.");
  return user;
}

const verifiedPrices = new Map<string, number>();

/** The Stripe Price must bill exactly what the catalogue says, monthly, in EUR. Throws (and logs) otherwise. */
async function verifyPrice(plan: Plan): Promise<void> {
  const at = verifiedPrices.get(plan.stripePriceId);
  if (at && Date.now() - at < PRICE_CHECK_TTL_MS) return;
  let price: Stripe.Price;
  try {
    price = await stripeClient().prices.retrieve(plan.stripePriceId);
  } catch (err) {
    log.error("subscription.price_unreadable", { planId: plan.id, error: err instanceof Error ? err.message : String(err) });
    throw new HttpError(503, "We couldn't reach the payment provider. Please try again in a moment.");
  }
  const problems: string[] = [];
  if (!price.active) problems.push("price is archived");
  if (price.currency !== "eur") problems.push(`currency ${price.currency}`);
  if (price.unit_amount !== plan.priceCents) problems.push(`amount ${price.unit_amount} instead of ${plan.priceCents}`);
  if (price.type !== "recurring" || price.recurring?.interval !== "month" || (price.recurring?.interval_count ?? 1) !== 1) problems.push("not billed monthly");
  if (plan.stripeProductId && idOf(price.product as string | Stripe.Product) !== plan.stripeProductId) problems.push("different product");
  if (problems.length) {
    log.error("subscription.price_mismatch", { planId: plan.id, priceId: plan.stripePriceId, problems });
    throw new HttpError(503, "This plan can't be bought right now. Please try again later.");
  }
  verifiedPrices.set(plan.stripePriceId, Date.now());
}

/** Tests only. */
export function resetSubscriptionCachesForTests() {
  verifiedPrices.clear();
}

async function ensureCustomer(user: { id: string; email: string; name: string; stripeCustomerId: string | null }): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripeClient().customers.create(
    { email: user.email, ...(user.name ? { name: user.name } : {}), metadata: { walletUserId: user.id } },
    { idempotencyKey: `customer_${user.id}` }
  );
  // Set once; a concurrent request got the same customer from the idempotency key.
  await prisma.user.updateMany({ where: { id: user.id, stripeCustomerId: null }, data: { stripeCustomerId: customer.id } });
  const saved = await prisma.user.findUnique({ where: { id: user.id }, select: { stripeCustomerId: true } });
  return saved?.stripeCustomerId ?? customer.id;
}

async function liveSubscription(walletUserId: string) {
  return prisma.subscription.findFirst({ where: { walletUserId, stripeSubscriptionId: { not: null }, status: { in: LIVE_STATUSES } }, orderBy: { createdAt: "desc" } });
}

/**
 * Starts Stripe Checkout (subscription mode) for `planId`, paid from `userId`'s own wallet. Returns the URL of
 * Stripe's hosted page. Nothing is granted here: the plan starts when Stripe reports the first invoice paid.
 * A second request for the same plan while its link is still open returns the same link.
 */
export async function createSubscriptionCheckout(userId: string, planId: string): Promise<string> {
  if (!subscriptionsAvailable()) throw new HttpError(503, "Plans can't be bought on this server yet.");
  const plan = planById(planId);
  if (!plan) throw new HttpError(400, "Unknown plan.");
  if (!planAvailable(plan)) throw new HttpError(503, `The ${plan.name} plan isn't available yet.`);
  const user = await assertWalletOwner(userId);

  return withLock(`subscription:${userId}`, async () => {
    const live = await liveSubscription(userId);
    if (live) throw new HttpError(409, `You already have the ${planById(live.planId)?.name ?? "current"} plan. Change or cancel it in Usage.`);
    const recent = new Date(Date.now() - (CHECKOUT_TTL_S - 5 * 60) * 1000);
    const pending = await prisma.subscription.findFirst({ where: { walletUserId: userId, status: "checkout_pending", createdAt: { gt: recent } }, orderBy: { createdAt: "desc" } });
    if (pending?.planId === plan.id && pending.checkoutUrl) return pending.checkoutUrl;
    if (pending) await abandonCheckout(pending);

    await verifyPrice(plan);
    let customer: string;
    try {
      customer = await ensureCustomer(user);
    } catch (err) {
      log.error("subscription.customer_failed", { walletUserId: userId, error: err instanceof Error ? err.message : String(err) });
      throw new HttpError(503, "We couldn't reach the payment provider. Please try again in a moment.");
    }
    const row = await prisma.subscription.create({
      data: { walletUserId: userId, planId: plan.id, status: "checkout_pending", stripeCustomerId: customer, stripePriceId: plan.stripePriceId },
    });
    const metadata = { kind: "subscription", subscriptionRowId: row.id, walletUserId: userId, planId: plan.id };
    let session: Stripe.Checkout.Session;
    try {
      session = await stripeClient().checkout.sessions.create(
        {
          mode: "subscription",
          customer,
          client_reference_id: row.id,
          line_items: [{ price: plan.stripePriceId, quantity: 1 }],
          metadata,
          subscription_data: { metadata },
          // Fixed destinations on our own app: never taken from the request.
          success_url: `${config.appUrl}/usage?subscription=success`,
          cancel_url: `${config.appUrl}/pricing?subscription=cancelled`,
          expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
        },
        { idempotencyKey: `subscription_checkout_${row.id}` }
      );
    } catch (err) {
      log.error("subscription.checkout_failed", { walletUserId: userId, planId: plan.id, error: err instanceof Error ? err.message : String(err) });
      await prisma.subscription.update({ where: { id: row.id }, data: { status: "checkout_failed" } });
      throw new HttpError(503, "We couldn't reach the payment provider. Please try again in a moment.");
    }
    if (!session.url) {
      await prisma.subscription.update({ where: { id: row.id }, data: { status: "checkout_failed" } });
      throw new HttpError(503, "The payment provider didn't return a checkout page. Please try again.");
    }
    await prisma.subscription.update({ where: { id: row.id }, data: { stripeCheckoutSessionId: session.id, checkoutUrl: session.url } });
    log.info("subscription.checkout_started", { walletUserId: userId, planId: plan.id, subscriptionId: row.id });
    return session.url;
  });
}

/** A newer checkout replaces an open one for another plan: the old link is closed so it can't be paid too. */
async function abandonCheckout(row: SubscriptionRow) {
  await prisma.subscription.updateMany({ where: { id: row.id, status: "checkout_pending" }, data: { status: "checkout_expired", checkoutUrl: null } });
  if (!row.stripeCheckoutSessionId) return;
  try {
    await stripeClient().checkout.sessions.expire(row.stripeCheckoutSessionId);
  } catch (err) {
    // Already completed or expired at Stripe: a completed one still arrives by webhook and is honoured.
    log.warn("subscription.checkout_expire_failed", { subscriptionId: row.id, error: err instanceof Error ? err.message : String(err) });
  }
}

// ------------------------------------------------------------------ state from Stripe

/** The row for a Stripe subscription: linked already, or linked now through our checkout metadata, or adopted. */
async function rowFor(s: AnySub): Promise<SubscriptionRow | null> {
  const linked = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: s.id } });
  if (linked) return linked;
  const customerId = idOf(s.customer as string | Stripe.Customer);
  const rowId = s.metadata?.subscriptionRowId;
  if (rowId) {
    const row = await prisma.subscription.findUnique({ where: { id: rowId } });
    if (row && !row.stripeSubscriptionId && row.walletUserId === s.metadata?.walletUserId && (!row.stripeCustomerId || row.stripeCustomerId === customerId)) {
      const done = await prisma.subscription.updateMany({ where: { id: row.id, stripeSubscriptionId: null }, data: { stripeSubscriptionId: s.id } });
      if (done.count) return prisma.subscription.findUnique({ where: { id: row.id } });
      return prisma.subscription.findUnique({ where: { stripeSubscriptionId: s.id } });
    }
    if (row) log.error("subscription.metadata_mismatch", { stripeSubscriptionId: s.id, subscriptionRowId: rowId });
  }
  // Created outside our checkout (for example in the Stripe dashboard) for one of our customers, on a plan price.
  const owner = customerId ? await prisma.user.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } }) : null;
  const plan = planByPriceId(subPriceId(s));
  if (owner && plan) {
    log.warn("subscription.adopted", { stripeSubscriptionId: s.id, walletUserId: owner.id, planId: plan.id });
    return prisma.subscription.create({ data: { walletUserId: owner.id, planId: plan.id, status: s.status, stripeCustomerId: customerId, stripeSubscriptionId: s.id, stripePriceId: plan.stripePriceId } });
  }
  log.warn("subscription.unknown", { stripeSubscriptionId: s.id });
  return null;
}

/** Writes Stripe's state read at `readAt` onto the row, unless a newer read is already there. */
async function applyState(rowId: string, s: AnySub, readAt: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [cur] = await tx.$queryRaw<{ stripeSyncedAt: Date | null; planId: string }[]>`
      SELECT "stripeSyncedAt", "planId" FROM "Subscription" WHERE "id" = ${rowId} FOR UPDATE`;
    if (!cur || (cur.stripeSyncedAt && cur.stripeSyncedAt > readAt)) return;
    const period = subPeriod(s);
    const billed = planByPriceId(subPriceId(s));
    const current = planById(cur.planId);
    // A cheaper plan billed from the next renewal is a scheduled downgrade. A dearer one is an upgrade whose
    // prorated invoice is being paid: the plan switches when that invoice is (applyPaidInvoice).
    const nextPlanId = billed && current && billed.id !== current.id && billed.monthlyCredits < current.monthlyCredits ? billed.id : null;
    await tx.subscription.update({
      where: { id: rowId },
      data: {
        status: s.status,
        stripeCustomerId: idOf(s.customer as string | Stripe.Customer),
        stripePriceId: subPriceId(s),
        nextPlanId,
        cancelAtPeriodEnd: !!s.cancel_at_period_end,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        canceledAt: ts(s.canceled_at),
        endedAt: ts(s.ended_at),
        checkoutUrl: null,
        stripeSyncedAt: readAt,
      },
    });
  });
}

/** Re-reads the subscription from Stripe and applies it. Returns the row, or null when it isn't ours. */
export async function syncSubscription(stripeSubscriptionId: string): Promise<SubscriptionRow | null> {
  const readAt = new Date();
  const s = (await stripeClient().subscriptions.retrieve(stripeSubscriptionId)) as AnySub;
  const row = await rowFor(s);
  if (!row) return null;
  await applyState(row.id, s, readAt);
  return prisma.subscription.findUnique({ where: { id: row.id } });
}

// ------------------------------------------------------------------ the allowance

type GrantResult = "granted" | "upgraded" | "already" | "ignored" | "unknown_plan";

/** Grants what a paid invoice pays for, exactly once per invoice. */
export async function applyPaidInvoice(rowId: string, inv: AnyInvoice): Promise<GrantResult> {
  if (inv.status !== "paid") return "ignored";
  const reason = inv.billing_reason;
  const lines = (inv.lines?.data ?? []) as AnyLine[];
  const key = `allowance:${inv.id}`;
  return prisma.$transaction(async (tx) => {
    const head = await tx.subscription.findUniqueOrThrow({ where: { id: rowId }, select: { walletUserId: true } });
    await lockWallet(tx, head.walletUserId);
    await tx.$queryRaw`SELECT 1 FROM "Subscription" WHERE "id" = ${rowId} FOR UPDATE`;
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: rowId } });
    if (await tx.transaction.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) return "already";

    if (reason === "subscription_create" || reason === "subscription_cycle") {
      const line = lines.find((l) => !l.proration && planByPriceId(linePriceId(l))) ?? lines.find((l) => planByPriceId(linePriceId(l)));
      const plan = line ? planByPriceId(linePriceId(line)) : null;
      if (!line || !plan) {
        log.error("subscription.invoice_unknown_price", { subscriptionId: rowId, invoiceId: inv.id });
        return "unknown_plan";
      }
      // Nothing paid (a trial or a 100% coupon set up in Stripe; the app's checkout offers neither): no credits.
      if (inv.amount_paid <= 0 && plan.priceCents > 0) {
        log.error("subscription.invoice_nothing_paid", { subscriptionId: rowId, invoiceId: inv.id, planId: plan.id });
        return "ignored";
      }
      if (inv.amount_paid < plan.priceCents) {
        log.warn("subscription.invoice_amount_low", { subscriptionId: rowId, invoiceId: inv.id, amountPaid: inv.amount_paid, planId: plan.id });
      }
      const start = new Date(line.period.start * 1000);
      const end = new Date(line.period.end * 1000);
      // One allowance per paid period: whatever is left of the previous one ends here.
      if (sub.allowanceCredits > 0) await expireAllowance(tx, rowId, { force: true });
      await creditWallet(tx, {
        walletUserId: sub.walletUserId,
        actorUserId: null,
        type: "GRANT",
        amountCents: plan.monthlyCredits,
        description: `${plan.name} plan: ${formatCredits(plan.monthlyCredits)} for ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
        reason: "subscription_allowance",
        idempotencyKey: key,
        allowance: { subscriptionId: rowId, cents: plan.monthlyCredits },
      });
      await tx.subscription.update({
        where: { id: rowId },
        data: { planId: plan.id, allowanceGranted: plan.monthlyCredits, allowancePeriodStart: start, allowancePeriodEnd: end, lastPaymentError: null },
      });
      log.info("subscription.allowance_granted", { subscriptionId: rowId, invoiceId: inv.id, planId: plan.id, credits: plan.monthlyCredits });
      return "granted";
    }

    if (reason === "subscription_update") {
      // A paid upgrade: the positive prorated line is the new plan for the rest of the period.
      const line = lines.find((l) => l.amount > 0 && planByPriceId(linePriceId(l)));
      const next = line ? planByPriceId(linePriceId(line)) : null;
      const prev = planById(sub.planId);
      if (!line || !next || !prev || next.monthlyCredits <= prev.monthlyCredits) return "ignored";
      let extra = 0;
      const { allowancePeriodStart: ps, allowancePeriodEnd: pe } = sub;
      if (ps && pe && pe > new Date()) {
        const full = pe.getTime() - ps.getTime();
        const left = Math.min(full, Math.max(0, (line.period.end - line.period.start) * 1000));
        extra = full > 0 ? Math.floor(((next.monthlyCredits - prev.monthlyCredits) * left) / full) : 0;
      }
      if (extra > 0) {
        await creditWallet(tx, {
          walletUserId: sub.walletUserId,
          actorUserId: null,
          type: "GRANT",
          amountCents: extra,
          description: `Upgrade from ${prev.name} to ${next.name}: ${formatCredits(extra)} for the rest of this billing period`,
          reason: "subscription_allowance",
          idempotencyKey: key,
          allowance: { subscriptionId: rowId, cents: extra },
        });
      }
      await tx.subscription.update({ where: { id: rowId }, data: { planId: next.id, nextPlanId: null, allowanceGranted: { increment: extra } } });
      log.info("subscription.upgraded", { subscriptionId: rowId, invoiceId: inv.id, from: prev.id, to: next.id, credits: extra });
      return "upgraded";
    }
    return "ignored"; // manual or other invoices grant nothing
  });
}

async function rowForInvoice(inv: AnyInvoice): Promise<SubscriptionRow | null> {
  const subId = invoiceSubscriptionId(inv);
  if (!subId) return null; // not a subscription invoice (a one-off payment never grants an allowance)
  return (await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subId } })) ?? (await syncSubscription(subId));
}

async function onInvoicePaid(invoiceId: string) {
  const inv = (await stripeClient().invoices.retrieve(invoiceId)) as AnyInvoice;
  const row = await rowForInvoice(inv);
  if (!row) return;
  await applyPaidInvoice(row.id, inv);
  await syncSubscription(row.stripeSubscriptionId ?? invoiceSubscriptionId(inv)!);
}

async function onInvoicePaymentFailed(invoiceId: string) {
  const inv = (await stripeClient().invoices.retrieve(invoiceId)) as AnyInvoice;
  const row = await rowForInvoice(inv);
  if (!row) return;
  // No card details: just that it failed and how many attempts Stripe has made.
  await prisma.subscription.update({ where: { id: row.id }, data: { lastPaymentError: `Payment failed (attempt ${inv.attempt_count ?? 1})` } });
  await syncSubscription(row.stripeSubscriptionId ?? invoiceSubscriptionId(inv)!);
  log.warn("subscription.payment_failed", { subscriptionId: row.id, invoiceId, attempt: inv.attempt_count });
}

async function checkoutRow(session: Stripe.Checkout.Session): Promise<SubscriptionRow | null> {
  const id = session.metadata?.subscriptionRowId ?? session.client_reference_id;
  const row = id ? await prisma.subscription.findUnique({ where: { id } }) : null;
  if (!row || (row.stripeCheckoutSessionId && row.stripeCheckoutSessionId !== session.id)) {
    log.error("subscription.checkout_unknown", { sessionId: session.id });
    return null;
  }
  return row;
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  const row = await checkoutRow(session);
  const subId = idOf(session.subscription as string | Stripe.Subscription | null);
  if (!row || !subId) return;
  const others = await prisma.subscription.count({ where: { walletUserId: row.walletUserId, id: { not: row.id }, stripeSubscriptionId: { not: null }, status: { in: LIVE_STATUSES } } });
  if (others) log.error("subscription.duplicate", { walletUserId: row.walletUserId, subscriptionId: row.id, stripeSubscriptionId: subId });
  await prisma.subscription.updateMany({ where: { id: row.id, stripeSubscriptionId: null }, data: { stripeSubscriptionId: subId, stripeCheckoutSessionId: session.id } });
  await syncSubscription(subId);
}

/**
 * Handles the subscription side of a verified Stripe event. Returns false for events it doesn't own (one-off
 * credit packs are handled in billing/stripe.ts). Throws on failure, so the webhook answers 500 and Stripe retries.
 */
export async function handleSubscriptionEvent(event: Stripe.Event): Promise<boolean> {
  const obj = event.data.object as unknown as Record<string, unknown> & { id: string };
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = obj as unknown as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return false;
      await onCheckoutCompleted(session);
      return true;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = obj as unknown as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return false;
      const row = await checkoutRow(session);
      if (row) await prisma.subscription.updateMany({ where: { id: row.id, status: "checkout_pending" }, data: { status: "checkout_expired", checkoutUrl: null } });
      return true;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.pending_update_applied":
    case "customer.subscription.pending_update_expired":
      await syncSubscription(obj.id);
      return true;
    case "invoice.paid":
      await onInvoicePaid(obj.id);
      return true;
    case "invoice.payment_failed":
      await onInvoicePaymentFailed(obj.id);
      return true;
    default:
      return false;
  }
}

// ------------------------------------------------------------------ managing a subscription

async function manageableSubscription(userId: string) {
  await assertWalletOwner(userId);
  const row = await liveSubscription(userId);
  if (!row || !row.stripeSubscriptionId) throw new HttpError(404, "You don't have a plan to manage.");
  return row as SubscriptionRow & { stripeSubscriptionId: string };
}

const updateKey = (row: SubscriptionRow, what: string) => `subscription_${row.id}_${what}_${row.stripeSyncedAt?.getTime() ?? 0}`;

/** Cancel at the end of the paid period (true), or keep the plan after all (false). */
export async function setCancelAtPeriodEnd(userId: string, cancel: boolean): Promise<void> {
  if (!config.stripe.enabled) throw new HttpError(503, "Payments aren't configured on this server.");
  return withLock(`subscription:${userId}`, async () => {
    const row = await manageableSubscription(userId);
    if (!["active", "trialing", "past_due"].includes(row.status)) throw new HttpError(409, "This plan can't be changed right now.");
    const readAt = new Date();
    const s = (await stripeClient().subscriptions.update(row.stripeSubscriptionId, { cancel_at_period_end: cancel }, { idempotencyKey: updateKey(row, cancel ? "cancel" : "resume") })) as AnySub;
    await applyState(row.id, s, readAt);
    log.info(cancel ? "subscription.cancel_requested" : "subscription.resumed", { subscriptionId: row.id });
  });
}

/** Upgrades now (prorated, paid before it applies) or downgrades from the next renewal. */
export async function changePlan(userId: string, planId: string): Promise<{ change: "upgraded" | "downgrade_scheduled" | "scheduled_change_cancelled" }> {
  if (!subscriptionsAvailable()) throw new HttpError(503, "Plans can't be changed on this server yet.");
  const target = planById(planId);
  if (!target) throw new HttpError(400, "Unknown plan.");
  if (!planAvailable(target)) throw new HttpError(503, `The ${target.name} plan isn't available yet.`);
  return withLock(`subscription:${userId}`, async () => {
    const row = await manageableSubscription(userId);
    if (row.status === "past_due" || row.status === "unpaid") throw new HttpError(409, "Your last payment didn't go through. Update your payment method first.");
    if (row.status !== "active" && row.status !== "trialing") throw new HttpError(409, "This plan can't be changed right now.");
    if (row.cancelAtPeriodEnd) throw new HttpError(409, "Your plan is set to end. Keep it first, then change it.");
    const current = planById(row.planId);
    if (!current) throw new HttpError(409, "Your current plan is no longer offered. Contact support to change it.");
    const stripe = stripeClient();
    const live = (await stripe.subscriptions.retrieve(row.stripeSubscriptionId)) as AnySub;
    const item = live.items.data[0];
    if (!item) throw new HttpError(409, "This plan can't be changed right now.");
    const readAt = new Date();

    if (row.nextPlanId) {
      if (target.id !== current.id) throw new HttpError(409, `A change to ${planById(row.nextPlanId)?.name ?? "another plan"} is already scheduled. Keep your current plan first.`);
      const s = (await stripe.subscriptions.update(row.stripeSubscriptionId, { items: [{ id: item.id, price: current.stripePriceId }], proration_behavior: "none" }, { idempotencyKey: updateKey(row, `keep_${current.id}`) })) as AnySub;
      await applyState(row.id, s, readAt);
      return { change: "scheduled_change_cancelled" };
    }
    if (target.id === current.id) throw new HttpError(400, `You're already on the ${current.name} plan.`);
    await verifyPrice(target);

    if (target.monthlyCredits > current.monthlyCredits) {
      // Charged now for the rest of the period; Stripe applies the change only once that payment succeeds.
      const s = (await stripe.subscriptions.update(
        row.stripeSubscriptionId,
        { items: [{ id: item.id, price: target.stripePriceId }], proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" },
        { idempotencyKey: updateKey(row, `to_${target.id}`) }
      )) as AnySub;
      if (s.pending_update) {
        throw new HttpError(402, `Your card couldn't be charged for the upgrade to ${target.name}, so your plan hasn't changed. Update your payment method in Billing, then try again.`);
      }
      await applyState(row.id, s, readAt);
      log.info("subscription.upgrade_requested", { subscriptionId: row.id, from: current.id, to: target.id });
      return { change: "upgraded" };
    }
    const s = (await stripe.subscriptions.update(row.stripeSubscriptionId, { items: [{ id: item.id, price: target.stripePriceId }], proration_behavior: "none" }, { idempotencyKey: updateKey(row, `to_${target.id}`) })) as AnySub;
    await applyState(row.id, s, readAt);
    log.info("subscription.downgrade_scheduled", { subscriptionId: row.id, from: current.id, to: target.id });
    return { change: "downgrade_scheduled" };
  });
}

/** A Stripe Customer Portal session (payment method, invoices, cancellation) that returns to Usage. */
export async function createPortalSession(userId: string): Promise<string> {
  if (!config.stripe.enabled) throw new HttpError(503, "Payments aren't configured on this server.");
  const user = await assertWalletOwner(userId);
  if (!user.stripeCustomerId) throw new HttpError(404, "There's no billing account for you yet. Choose a plan first.");
  try {
    const s = await stripeClient().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${config.appUrl}/usage?portal=return`,
      ...(config.subscriptions.portalConfigurationId ? { configuration: config.subscriptions.portalConfigurationId } : {}),
    });
    return s.url;
  } catch (err) {
    log.error("subscription.portal_failed", { walletUserId: userId, error: err instanceof Error ? err.message : String(err) });
    throw new HttpError(503, "We couldn't open billing right now. Please try again in a moment.");
  }
}

// ------------------------------------------------------------------ what the Usage page shows

/** The plan, its state and the credit split for `userId`'s wallet — the wallet owner's view only. */
export async function subscriptionSummary(userId: string) {
  const wallet = await resolveWallet(userId);
  const balance = await spendableBalance(userId);
  const allowance = await prisma.subscription.aggregate({ where: { walletUserId: wallet.walletUserId }, _sum: { allowanceCredits: true } });
  const planCredits = allowance._sum.allowanceCredits ?? 0;
  const credits = { planCreditsCents: planCredits, otherCreditsCents: Math.max(0, balance.credits - planCredits) };
  if (wallet.walletUserId !== userId) return { subscription: null, credits, managedByOwner: true };

  const row =
    (await liveSubscription(userId)) ??
    (await prisma.subscription.findFirst({
      where: { walletUserId: userId, OR: [{ status: "checkout_pending", createdAt: { gt: new Date(Date.now() - CHECKOUT_TTL_S * 1000) } }, { allowanceCredits: { gt: 0 } }] },
      orderBy: { createdAt: "desc" },
    }));
  if (!row) return { subscription: null, credits, managedByOwner: false };
  const plan = planById(row.planId);
  const entitled = !!row.stripeSubscriptionId && entitledStatuses().includes(row.status);
  return {
    credits,
    managedByOwner: false,
    subscription: {
      planId: row.planId,
      planName: plan?.name ?? row.planId,
      priceCents: plan?.priceCents ?? null,
      monthlyCredits: plan?.monthlyCredits ?? null,
      status: row.status,
      entitled,
      runsPerDay: entitlementsForPlan(entitled ? plan : null).runsPerDay,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      nextPlanId: row.nextPlanId,
      nextPlanName: planById(row.nextPlanId)?.name ?? null,
      allowanceGranted: row.allowanceGranted,
      allowanceRemaining: row.allowanceCredits,
      allowancePeriodEnd: row.allowancePeriodEnd?.toISOString() ?? null,
      paymentProblem: row.status === "past_due" || row.status === "unpaid" || row.status === "incomplete" ? row.lastPaymentError ?? "Payment failed" : null,
      endedAt: row.endedAt?.toISOString() ?? null,
    },
  };
}

// ------------------------------------------------------------------ maintenance

/** Expires allowances whose paid period has ended, and closes checkout links that have run out. */
export async function sweepSubscriptions(now = new Date()): Promise<{ expired: number; checkouts: number }> {
  const due = await prisma.subscription.findMany({ where: { allowanceCredits: { gt: 0 }, allowancePeriodEnd: { lte: now } }, select: { id: true }, take: 200 });
  let expired = 0;
  for (const s of due) {
    try {
      expired += await prisma.$transaction((tx) => expireAllowance(tx, s.id, { now }));
    } catch (err) {
      log.error("subscription.expiry_failed", { subscriptionId: s.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const checkouts = await prisma.subscription.updateMany({
    where: { status: "checkout_pending", createdAt: { lt: new Date(now.getTime() - CHECKOUT_TTL_S * 1000) } },
    data: { status: "checkout_expired", checkoutUrl: null },
  });
  if (expired) log.info("subscription.allowances_expired", { credits: expired, subscriptions: due.length });
  return { expired, checkouts: checkouts.count };
}
