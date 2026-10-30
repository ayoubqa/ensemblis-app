import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { checkoutLimiter } from "../lib/rateLimits";
import { TRANSACTION_INCLUDE, loadPublicUser, toPublicTransaction } from "../lib/serializers";
import { creditWallet, resolveWallet, spendableBalance } from "../lib/wallet";
import { config } from "../config";
import { formatCredits } from "./credits";
import { createCheckoutSession } from "./stripe";
import { changePlan, createPortalSession, createSubscriptionCheckout, setCancelAtPeriodEnd, subscriptionSummary } from "./subscriptions";

// Usage & billing. The wallet is a balance of Ensemblis credits (billing/credits.ts);
// executions are charged their planned estimate when they start and refunded
// automatically for work that fails or doesn't run (engine/billing.ts).
// Wallet-aware billing (v3). Team members see the
// team wallet (the owner's balance) and its activity since they joined;
// only the wallet's owner can add credits (demo top-up or Stripe).
const router = Router();
router.use(requireAuth);

const startOfMonthUTC = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** Net spend = charges minus refunds (top-ups/purchases excluded), as a positive number. */
async function netSpend(where: Prisma.TransactionWhereInput, since?: Date): Promise<number> {
  const agg = await prisma.transaction.aggregate({
    where: { AND: [where, { type: { in: ["TASK_CHARGE", "REFUND"] } }, since ? { createdAt: { gte: since } } : {}] },
    _sum: { amountCents: true },
  });
  return Math.max(0, -(agg._sum.amountCents ?? 0));
}

/** Which slice of the ledger `userId` may see: their wallet, from when they joined (members). */
export async function visibleLedgerWhere(userId: string): Promise<Prisma.TransactionWhereInput> {
  const wallet = await resolveWallet(userId);
  if (wallet.walletUserId === userId) return { userId };
  const membership = await prisma.teamMember.findUnique({ where: { userId }, select: { joinedAt: true } });
  return { userId: wallet.walletUserId, ...(membership ? { createdAt: { gte: membership.joinedAt } } : {}) };
}

/** Execution spend this month, per objective (v4 usage view). */
async function executionUsage(where: Prisma.TransactionWhereInput, since: Date) {
  const rows = await prisma.transaction.groupBy({
    by: ["executionId"],
    where: { AND: [where, { executionId: { not: null } }, { type: { in: ["TASK_CHARGE", "REFUND"] } }, { createdAt: { gte: since } }] },
    _sum: { amountCents: true },
  });
  const ids = rows.map((r) => r.executionId!).filter(Boolean);
  const execs = ids.length
    ? await prisma.execution.findMany({ where: { id: { in: ids } }, select: { id: true, objectiveId: true, objective: { select: { title: true } } } })
    : [];
  const byObjective = new Map<string, { objectiveId: string; title: string; spendCents: number; executions: number }>();
  for (const r of rows) {
    const ex = execs.find((e) => e.id === r.executionId);
    if (!ex) continue;
    const cur = byObjective.get(ex.objectiveId) ?? { objectiveId: ex.objectiveId, title: ex.objective.title, spendCents: 0, executions: 0 };
    cur.spendCents += Math.max(0, -(r._sum.amountCents ?? 0));
    cur.executions += 1;
    byObjective.set(ex.objectiveId, cur);
  }
  const list = [...byObjective.values()].sort((a, b) => b.spendCents - a.spendCents);
  const total = list.reduce((n, o) => n + o.spendCents, 0);
  const count = list.reduce((n, o) => n + o.executions, 0);
  return { monthExecutions: count, monthExecutionSpendCents: total, avgExecutionCostCents: count ? Math.round(total / count) : 0, byObjective: list.slice(0, 10) };
}

export async function billingSummary(userId: string) {
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  const where = await visibleLedgerWhere(userId);
  const since = startOfMonthUTC();
  const [balance, monthSpendCents, lifetimeSpendCents, transactions, usage, plan] = await Promise.all([
    spendableBalance(userId),
    netSpend(where, since),
    netSpend(where),
    prisma.transaction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, include: TRANSACTION_INCLUDE }),
    executionUsage(where, since),
    subscriptionSummary(userId),
  ]);
  return {
    balanceCents: balance.credits,
    walletOwner: balance.walletOwner,
    // Of the balance: unused plan allowance (expires at its period end) and everything else (never expires).
    credits: plan.credits,
    // The wallet owner's plan; null for members (managed by the owner) and for accounts without a plan.
    subscription: plan.subscription,
    monthSpendCents,
    lifetimeSpendCents,
    usage,
    transactions: transactions.slice(0, 50).map(toPublicTransaction),
    nextCursor: transactions.length > 50 ? transactions[49].id : null,
  };
}

router.get(
  "/",
  ah<AuthedRequest>(async (req, res) => {
    res.json(await billingSummary(req.userId!));
  })
);

// Older ledger pages.
router.get(
  "/transactions",
  ah<AuthedRequest>(async (req, res) => {
    const { cursor } = parse(z.object({ cursor: z.string().max(64) }), req.query);
    const where = await visibleLedgerWhere(req.userId!);
    const rows = await prisma.transaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      cursor: { id: cursor },
      skip: 1,
      take: 51,
      include: TRANSACTION_INCLUDE,
    });
    res.json({ transactions: rows.slice(0, 50).map(toPublicTransaction), nextCursor: rows.length > 50 ? rows[49].id : null });
  })
);

const topupSchema = z.object({
  amountCents: z
    .number({ invalid_type_error: "amountCents must be a number" })
    .int("amountCents must be a whole number of credits")
    .min(100, "The minimum top-up is 100 credits")
    .max(50000, "The maximum top-up is 50,000 credits per request"),
});

/** Who may add credits to the wallet `userId` spends from. Throws 403 otherwise. */
async function assertWalletOwner(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isGuest: true } });
  if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  if (user.isGuest) throw new HttpError(403, "Create a free account to add credits.");
  const wallet = await resolveWallet(userId);
  if (wallet.walletUserId !== userId) throw new HttpError(403, "Only your team owner can add credits");
}

/** Demo credits (no real money). Lifetime cap per wallet. */
export async function demoTopUp(userId: string, amountCents: number): Promise<void> {
  if (!config.topupEnabled || config.topupMaxCents <= 0) {
    throw new HttpError(403, "Demo credit top-ups are turned off on this server.");
  }
  await assertWalletOwner(userId);
  await prisma.$transaction(async (tx) => {
    // Credit first: the balance update locks the wallet row, so a concurrent
    // top-up waits and then sees this one when it checks the cap below.
    await creditWallet(tx, {
      walletUserId: userId,
      actorUserId: userId,
      type: "TOP_UP",
      amountCents,
      description: `Demo credits added: ${formatCredits(amountCents)} (no real money)`,
      reason: "demo_top_up",
    });
    const agg = await tx.transaction.aggregate({ where: { userId, type: "TOP_UP" }, _sum: { amountCents: true } });
    const total = agg._sum.amountCents ?? 0;
    if (total > config.topupMaxCents) {
      const left = Math.max(0, config.topupMaxCents - (total - amountCents));
      throw new HttpError(
        403,
        left > 0
          ? `Demo top-up limit: you can add at most ${formatCredits(left)} more demo credits to this account.`
          : `You've used this account's demo top-up allowance (${formatCredits(config.topupMaxCents)}). No more demo credits can be added.`
      );
    }
  });
}

router.post(
  "/topup",
  ah<AuthedRequest>(async (req, res) => {
    const { amountCents } = parse(topupSchema, req.body);
    await demoTopUp(req.userId!, amountCents);
    res.json({ billing: await billingSummary(req.userId!), user: await loadPublicUser(req.userId!) });
  })
);

const checkoutSchema = z.object({ packId: z.string().trim().min(1, "Choose a credit pack").max(40) });

// v3: Stripe Checkout. The browser is redirected to `url`; credits arrive via the webhook.
router.post(
  "/checkout",
  checkoutLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const { packId } = parse(checkoutSchema, req.body);
    const url = await createCheckoutSession(req.userId!, packId);
    res.json({ url });
  })
);

// Monthly plans (billing/subscriptions.ts). The client names a plan id only: the price, the Stripe Price and
// the allowance come from the server's catalogue (billing/plans.ts). Extra fields in the body are ignored.
const planSchema = z.object({ planId: z.enum(["starter", "growth", "business"], { errorMap: () => ({ message: "Choose a plan" }) }) });

router.post(
  "/subscription/checkout",
  checkoutLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const { planId } = parse(planSchema, req.body);
    res.json({ url: await createSubscriptionCheckout(req.userId!, planId) });
  })
);

router.post(
  "/subscription/change",
  checkoutLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const { planId } = parse(planSchema, req.body);
    const result = await changePlan(req.userId!, planId);
    res.json({ ...result, billing: await billingSummary(req.userId!) });
  })
);

router.post(
  "/subscription/cancel",
  checkoutLimiter,
  ah<AuthedRequest>(async (req, res) => {
    await setCancelAtPeriodEnd(req.userId!, true);
    res.json({ billing: await billingSummary(req.userId!) });
  })
);

router.post(
  "/subscription/resume",
  checkoutLimiter,
  ah<AuthedRequest>(async (req, res) => {
    await setCancelAtPeriodEnd(req.userId!, false);
    res.json({ billing: await billingSummary(req.userId!) });
  })
);

router.post(
  "/subscription/portal",
  checkoutLimiter,
  ah<AuthedRequest>(async (req, res) => {
    res.json({ url: await createPortalSession(req.userId!) });
  })
);

export default router;
