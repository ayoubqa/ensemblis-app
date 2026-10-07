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
import { createCheckoutSession } from "./stripe";

// Wallet-aware billing (v3). 1 credit = 1 cent (EUR). Team members see the
// team wallet (the owner's balance) and its activity since they joined;
// only the wallet's owner can add credits (demo top-up or Stripe).
const router = Router();
router.use(requireAuth);

const startOfMonthUTC = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};
const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

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

export async function billingSummary(userId: string) {
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  const where = await visibleLedgerWhere(userId);
  const [balance, monthSpendCents, lifetimeSpendCents, transactions] = await Promise.all([
    spendableBalance(userId),
    netSpend(where, startOfMonthUTC()),
    netSpend(where),
    prisma.transaction.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: TRANSACTION_INCLUDE }),
  ]);
  return {
    balanceCents: balance.credits,
    monthSpendCents,
    lifetimeSpendCents,
    transactions: transactions.map(toPublicTransaction),
  };
}

router.get(
  "/",
  ah<AuthedRequest>(async (req, res) => {
    res.json(await billingSummary(req.userId!));
  })
);

const topupSchema = z.object({
  amountCents: z
    .number({ invalid_type_error: "amountCents must be a number" })
    .int("amountCents must be a whole number of cents")
    .min(100, "Minimum top-up is €1")
    .max(50000, "Maximum top-up is €500 per request"),
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
      description: `Demo credit top-up (${eur(amountCents)})`,
    });
    const agg = await tx.transaction.aggregate({ where: { userId, type: "TOP_UP" }, _sum: { amountCents: true } });
    const total = agg._sum.amountCents ?? 0;
    if (total > config.topupMaxCents) {
      const left = Math.max(0, config.topupMaxCents - (total - amountCents));
      throw new HttpError(
        403,
        left > 0
          ? `Demo top-up limit: you can add at most ${eur(left)} more demo credits to this account.`
          : `You've used this account's demo top-up allowance (${eur(config.topupMaxCents)}). No more demo credits can be added.`
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

export default router;
