// Real payments via Stripe Checkout (v3). Off unless STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET are both set.
//
// Flow: POST /api/billing/checkout creates a StripePayment row (pending) and a
// Checkout Session for one of config.creditPacks (prices are always taken from
// the server config, never from the client). Stripe redirects the browser
// back to /billing; the credits are added ONLY by the signed webhook
// (checkout.session.completed with payment_status "paid"), exactly once.

import { randomBytes } from "crypto";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError } from "../lib/http";
import { creditWallet, resolveWallet } from "../lib/wallet";

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  if (!client) client = new Stripe(config.stripe.secretKey, { maxNetworkRetries: 1, timeout: 20_000 });
  return client;
}

/** Tests only: swap in a stub client. */
export function setStripeClientForTests(c: Stripe | null) {
  client = c;
}

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/** Creates a Checkout Session for `packId`, paid into `userId`'s own wallet. Returns the URL to redirect to. */
export async function createCheckoutSession(userId: string, packId: string): Promise<string> {
  if (!config.stripe.enabled) throw new HttpError(503, "Card payments aren't set up on this server yet.");
  const pack = config.creditPacks.find((p) => p.id === packId);
  if (!pack) throw new HttpError(400, "Unknown credit pack");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isGuest: true } });
  if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  if (user.isGuest) throw new HttpError(403, "Create a free account to buy credits.");
  const wallet = await resolveWallet(userId);
  if (wallet.walletUserId !== userId) throw new HttpError(403, "Only your team owner can add credits");

  const payment = await prisma.stripePayment.create({
    data: {
      sessionId: `pending_${randomBytes(12).toString("hex")}`, // replaced by the real session id below
      userId,
      packId: pack.id,
      amountCents: pack.priceCents,
      credits: pack.credits,
      status: "pending",
    },
  });
  const metadata = { walletUserId: userId, packId: pack.id, stripePaymentId: payment.id };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: pack.priceCents,
              product_data: {
                name: `Ensemblis credits — ${pack.label}`,
                description: `${eur(pack.credits)} of task credits for your Ensemblis wallet`,
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        client_reference_id: userId,
        customer_email: user.email,
        success_url: `${config.appUrl}/usage?checkout=success`,
        cancel_url: `${config.appUrl}/usage?checkout=cancelled`,
      },
      { idempotencyKey: `checkout_${payment.id}` }
    );
  } catch (err) {
    console.error("[stripe] could not create a checkout session:", err instanceof Error ? err.message : err);
    await prisma.stripePayment
      .updateMany({ where: { id: payment.id, status: "pending" }, data: { status: "expired" } })
      .catch(() => undefined);
    throw new HttpError(503, "We couldn't reach the payment provider. Please try again in a moment.");
  }

  await prisma.stripePayment.update({ where: { id: payment.id }, data: { sessionId: session.id } });
  if (!session.url) throw new HttpError(503, "The payment provider didn't return a checkout page. Please try again.");
  return session.url;
}

async function findPayment(session: Stripe.Checkout.Session) {
  const id = session.metadata?.stripePaymentId;
  const byId = id ? await prisma.stripePayment.findUnique({ where: { id } }) : null;
  const payment = byId ?? (await prisma.stripePayment.findUnique({ where: { sessionId: session.id } }));
  if (!payment) return null;
  // The row must belong to this session (or still carry its placeholder id).
  if (payment.sessionId !== session.id && !payment.sessionId.startsWith("pending_")) return null;
  return payment;
}

/** Credits the wallet for a paid session exactly once. */
export async function fulfillCheckoutSession(session: Stripe.Checkout.Session): Promise<"credited" | "already" | "ignored"> {
  if (session.payment_status !== "paid") return "ignored";
  const payment = await findPayment(session);
  if (!payment) {
    console.error(`[stripe] paid session ${session.id} has no matching payment record — not credited.`);
    return "ignored";
  }
  if (session.amount_total != null && session.amount_total !== payment.amountCents) {
    console.warn(`[stripe] session ${session.id}: amount_total ${session.amount_total} ≠ expected ${payment.amountCents}`);
  }
  const pack = config.creditPacks.find((p) => p.id === payment.packId);
  return prisma.$transaction(async (tx) => {
    // The guard that makes double delivery harmless: only one transition pending -> completed.
    const flipped = await tx.stripePayment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: { status: "completed", completedAt: new Date(), sessionId: session.id },
    });
    if (flipped.count === 0) return "already" as const;
    await creditWallet(tx, {
      walletUserId: payment.userId,
      actorUserId: payment.userId,
      type: "PURCHASE",
      amountCents: payment.credits,
      description: `Purchased ${pack?.label ?? payment.packId} credit pack (${eur(payment.amountCents)})`,
    });
    return "credited" as const;
  });
}

async function expireCheckoutSession(session: Stripe.Checkout.Session) {
  const payment = await findPayment(session);
  if (!payment) return;
  await prisma.stripePayment.updateMany({ where: { id: payment.id, status: "pending" }, data: { status: "expired" } });
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfillCheckoutSession(event.data.object as Stripe.Checkout.Session);
      return;
    case "checkout.session.expired":
      await expireCheckoutSession(event.data.object as Stripe.Checkout.Session);
      return;
    default:
      return; // acknowledged, nothing to do
  }
}

/**
 * POST /api/billing/stripe/webhook — registered in index.ts with
 * express.raw({ type: "application/json" }) BEFORE the JSON parser (the
 * signature is computed over the raw bytes) and outside the rate limiter.
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!config.stripe.enabled) {
    res.status(503).json({ error: "Payments aren't configured on this server." });
    return;
  }
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "Invalid Stripe signature" });
    return;
  }
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(req.body, signature, config.stripe.webhookSecret);
  } catch {
    res.status(400).json({ error: "Invalid Stripe signature" });
    return;
  }
  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry later; the pending->completed guard keeps it idempotent.
    console.error(`[stripe] failed to process ${event.type} (${event.id}):`, err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}
