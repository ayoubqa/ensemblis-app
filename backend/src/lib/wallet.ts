// Wallets (v3). Every credit movement in the app goes through this file.
//
// A user's spendable balance is either their own User.credits ("self") or,
// when they belong to a team, the team OWNER's User.credits ("team"). A
// member's personal balance is untouched — and unused — while they are in a
// team. Transaction.userId is always the WALLET whose balance changed;
// Transaction.actorUserId is the person who triggered it.
//
// Balances are whole credits (billing/credits.ts). Every movement writes one
// ledger row in the same database transaction as the balance change, with its
// reason, the balance right after it and, when given, an idempotency key that
// the database keeps unique — so for every wallet credits = SUM(amountCents)
// (lib/ledger.ts checks this).
//
// Subscription allowance. A paid plan's monthly credits are part of the same
// balance; the part that is still unused allowance is tracked on the
// Subscription row (allowanceCredits <= credits, always). Debits spend
// allowance first, then everything else (purchased, starting, demo credits,
// which never expire). Every ledger row that moves allowance records how much
// (Transaction.allowanceCents), so for each subscription allowanceCredits =
// SUM(allowanceCents) too. Lock order, everywhere: the wallet's User row, then
// its Subscription rows.

import type { Prisma, PrismaClient, TransactionType } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "./http";
import { formatCredits, type LedgerReason } from "../billing/credits";

type Db = PrismaClient | Prisma.TransactionClient;

export interface WalletRef {
  walletUserId: string; // whose User.credits is debited/credited
  teamId: string | null; // the team, when paying from a team wallet
  via: "self" | "team";
}

/** Which wallet pays for `userId`'s spending right now. */
export async function resolveWallet(userId: string, db: Db = prisma): Promise<WalletRef> {
  const membership = await db.teamMember.findUnique({
    where: { userId },
    select: { teamId: true, team: { select: { ownerId: true } } },
  });
  if (membership) return { walletUserId: membership.team.ownerId, teamId: membership.teamId, via: "team" };
  return { walletUserId: userId, teamId: null, via: "self" };
}

/** The balance `userId` can spend (team wallet when in a team). */
export async function spendableBalance(userId: string, db: Db = prisma): Promise<{ credits: number; walletOwner: "self" | "team" }> {
  const w = await resolveWallet(userId, db);
  const owner = await db.user.findUnique({ where: { id: w.walletUserId }, select: { credits: true } });
  return { credits: owner?.credits ?? 0, walletOwner: w.via };
}

/** Locks the wallet's balance row for the rest of the transaction (always before its Subscription rows). */
export async function lockWallet(tx: Prisma.TransactionClient, walletUserId: string): Promise<number | null> {
  const rows = await tx.$queryRaw<{ credits: number }[]>`SELECT "credits" FROM "User" WHERE "id" = ${walletUserId} FOR UPDATE`;
  return rows[0]?.credits ?? null;
}

/**
 * Expires the subscription's unused allowance once its paid period has ended (or at once with `force`).
 * Idempotent: a period's expiry is recorded once (unique key) and leaves nothing to expire. Returns the
 * credits removed. Use inside a transaction.
 */
export async function expireAllowance(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  opts: { now?: Date; force?: boolean } = {}
): Promise<number> {
  const now = opts.now ?? new Date();
  const head = await tx.subscription.findUnique({ where: { id: subscriptionId }, select: { walletUserId: true } });
  if (!head) return 0;
  await lockWallet(tx, head.walletUserId);
  const [sub] = await tx.$queryRaw<{ allowanceCredits: number; allowancePeriodEnd: Date | null; planId: string }[]>`
    SELECT "allowanceCredits", "allowancePeriodEnd", "planId" FROM "Subscription" WHERE "id" = ${subscriptionId} FOR UPDATE`;
  if (!sub || sub.allowanceCredits <= 0) return 0;
  if (!opts.force && sub.allowancePeriodEnd && sub.allowancePeriodEnd > now) return 0;
  const amount = sub.allowanceCredits;
  const rows = await tx.$queryRaw<{ credits: number }[]>`
    UPDATE "User" SET "credits" = "credits" - ${amount} WHERE "id" = ${head.walletUserId} AND "credits" >= ${amount} RETURNING "credits"`;
  if (rows.length === 0) throw new Error(`expireAllowance: wallet ${head.walletUserId} holds less than its allowance (${amount}); not expired`);
  const end = sub.allowancePeriodEnd ?? now;
  await tx.transaction.create({
    data: {
      userId: head.walletUserId,
      actorUserId: null,
      type: "ADJUSTMENT",
      amountCents: -amount,
      description: `Unused plan credits expired at the end of the billing period (${end.toISOString().slice(0, 10)})`,
      reason: "allowance_expired",
      balanceAfter: rows[0].credits,
      idempotencyKey: `allowance_expiry:${subscriptionId}:${end.toISOString()}`,
      allowanceCents: -amount,
      subscriptionId,
    },
  });
  await tx.subscription.update({ where: { id: subscriptionId }, data: { allowanceCredits: 0 } });
  return amount;
}

/**
 * Removes plan credits that a refund just gave back from a billing period that has already ended: they
 * would have expired with that period. Recorded as their own expiry row, right after the refund.
 */
export async function expireRefundedAllowance(
  tx: Prisma.TransactionClient,
  args: { walletUserId: string; subscriptionId: string; cents: number; executionId: string }
): Promise<void> {
  if (args.cents <= 0) return;
  const rows = await tx.$queryRaw<{ credits: number }[]>`
    UPDATE "User" SET "credits" = "credits" - ${args.cents} WHERE "id" = ${args.walletUserId} AND "credits" >= ${args.cents} RETURNING "credits"`;
  if (rows.length === 0) throw new Error("expireRefundedAllowance: the refund was not applied first");
  await tx.transaction.create({
    data: {
      userId: args.walletUserId,
      actorUserId: null,
      type: "ADJUSTMENT",
      amountCents: -args.cents,
      description: "Refunded plan credits from a billing period that has ended: they expired with that period",
      executionId: args.executionId,
      reason: "allowance_expired",
      balanceAfter: rows[0].credits,
      subscriptionId: args.subscriptionId,
    },
  });
}

/** Expires every allowance of this wallet whose paid period has ended (before spending from it). */
async function expireEndedAllowances(tx: Prisma.TransactionClient, walletUserId: string): Promise<void> {
  const ended = await tx.subscription.findMany({
    where: { walletUserId, allowanceCredits: { gt: 0 }, allowancePeriodEnd: { lte: new Date() } },
    select: { id: true },
  });
  for (const s of ended) await expireAllowance(tx, s.id);
}

/** Spends up to `amount` from the wallet's current allowance (wallet row already locked). */
async function takeAllowance(tx: Prisma.TransactionClient, walletUserId: string, amount: number): Promise<{ subscriptionId: string; cents: number } | null> {
  const [sub] = await tx.$queryRaw<{ id: string; allowanceCredits: number }[]>`
    SELECT "id", "allowanceCredits" FROM "Subscription"
    WHERE "walletUserId" = ${walletUserId} AND "allowanceCredits" > 0
    ORDER BY "allowancePeriodEnd" ASC NULLS LAST LIMIT 1 FOR UPDATE`;
  if (!sub) return null;
  const cents = Math.min(sub.allowanceCredits, amount);
  await tx.$executeRaw`UPDATE "Subscription" SET "allowanceCredits" = "allowanceCredits" - ${cents} WHERE "id" = ${sub.id}`;
  return { subscriptionId: sub.id, cents };
}

/** A ledger row already recorded under `key` (the movement was applied before), or null. */
async function alreadyApplied(tx: Prisma.TransactionClient, key: string | null | undefined) {
  if (!key) return null;
  return tx.transaction.findUnique({ where: { idempotencyKey: key }, select: { id: true, balanceAfter: true } });
}

/**
 * Atomically debits `amountCents` credits from the wallet (conditional
 * decrement — safe under concurrency) and records a TASK_CHARGE. Throws 402 if
 * it can't afford it. Spends subscription allowance first (an allowance whose
 * period has ended is expired first, so it can't be spent); the charge row
 * records how much came from it. With an idempotency key, a repeat is a no-op
 * (and the unique key stops a concurrent duplicate). Must be called inside a
 * prisma.$transaction.
 */
export async function debitWallet(
  tx: Prisma.TransactionClient,
  args: {
    wallet: WalletRef;
    actorUserId: string;
    amountCents: number;
    description: string;
    taskId?: string | null;
    executionId?: string | null;
    reason?: LedgerReason;
    idempotencyKey?: string | null;
  }
): Promise<{ applied: boolean; balanceAfter: number | null }> {
  const { wallet, actorUserId, amountCents, description, taskId, executionId } = args;
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error("debitWallet: amount must be a whole number >= 0");
  const prior = await alreadyApplied(tx, args.idempotencyKey);
  if (prior) return { applied: false, balanceAfter: prior.balanceAfter };
  let balanceAfter: number;
  let allowance: { subscriptionId: string; cents: number } | null = null;
  if (amountCents > 0) {
    await lockWallet(tx, wallet.walletUserId);
    await expireEndedAllowances(tx, wallet.walletUserId);
    const rows = await tx.$queryRaw<{ credits: number }[]>`
      UPDATE "User" SET "credits" = "credits" - ${amountCents}
      WHERE "id" = ${wallet.walletUserId} AND "credits" >= ${amountCents}
      RETURNING "credits"`;
    if (rows.length === 0) {
      const owner = await tx.user.findUnique({ where: { id: wallet.walletUserId }, select: { credits: true } });
      if (!owner) throw new HttpError(401, "Account no longer exists");
      const whose = wallet.via === "team" ? "your team's balance" : "your balance";
      throw new HttpError(
        402,
        `Not enough credits: this needs ${formatCredits(amountCents)} and ${whose} is ${formatCredits(owner.credits)}. ` +
          (wallet.via === "team" ? "Ask your team owner to add credits in Usage." : "Add credits in Usage to continue.")
      );
    }
    balanceAfter = rows[0].credits;
    allowance = await takeAllowance(tx, wallet.walletUserId, amountCents);
  } else {
    const owner = await tx.user.findUnique({ where: { id: wallet.walletUserId }, select: { credits: true } });
    if (!owner) throw new HttpError(401, "Account no longer exists");
    balanceAfter = owner.credits;
  }
  await tx.transaction.create({
    data: {
      userId: wallet.walletUserId,
      actorUserId,
      type: "TASK_CHARGE",
      amountCents: -amountCents,
      description,
      taskId: taskId ?? null,
      executionId: executionId ?? null,
      reason: args.reason ?? "execution_charge",
      balanceAfter,
      idempotencyKey: args.idempotencyKey ?? null,
      allowanceCents: allowance ? -allowance.cents : null,
      subscriptionId: allowance?.subscriptionId ?? null,
    },
  });
  return { applied: true, balanceAfter };
}

/**
 * Credits a wallet (refund, demo top-up, Stripe purchase, grant, adjustment)
 * and records it. With `allowance`, that part of the amount is subscription
 * allowance (a monthly grant, or plan credits a refund gives back) and is added
 * to that subscription's unused allowance. With an idempotency key, a repeat is
 * a no-op. Use inside a transaction.
 */
export async function creditWallet(
  tx: Prisma.TransactionClient,
  args: {
    walletUserId: string;
    actorUserId: string | null;
    type: Exclude<TransactionType, "TASK_CHARGE">;
    amountCents: number;
    description: string;
    taskId?: string | null;
    executionId?: string | null;
    reason: LedgerReason;
    idempotencyKey?: string | null;
    allowance?: { subscriptionId: string; cents: number } | null;
  }
): Promise<{ applied: boolean; balanceAfter: number | null }> {
  const { walletUserId, actorUserId, type, amountCents, description, taskId, executionId } = args;
  if (!Number.isInteger(amountCents)) throw new Error("creditWallet: amount must be a whole number");
  const allowance = args.allowance && args.allowance.cents > 0 ? args.allowance : null;
  if (allowance && (!Number.isInteger(allowance.cents) || allowance.cents > amountCents)) throw new Error("creditWallet: allowance must be a whole part of the amount");
  if (amountCents <= 0) return { applied: false, balanceAfter: null };
  const prior = await alreadyApplied(tx, args.idempotencyKey);
  if (prior) return { applied: false, balanceAfter: prior.balanceAfter };
  const rows = await tx.$queryRaw<{ credits: number }[]>`
    UPDATE "User" SET "credits" = "credits" + ${amountCents} WHERE "id" = ${walletUserId} RETURNING "credits"`;
  if (rows.length === 0) throw new HttpError(401, "Account no longer exists");
  const balanceAfter = rows[0].credits;
  await tx.transaction.create({
    data: {
      userId: walletUserId,
      actorUserId,
      type,
      amountCents,
      description,
      taskId: taskId ?? null,
      executionId: executionId ?? null,
      reason: args.reason,
      balanceAfter,
      idempotencyKey: args.idempotencyKey ?? null,
      allowanceCents: allowance?.cents ?? null,
      subscriptionId: allowance?.subscriptionId ?? null,
    },
  });
  if (allowance) {
    await tx.$executeRaw`UPDATE "Subscription" SET "allowanceCredits" = "allowanceCredits" + ${allowance.cents} WHERE "id" = ${allowance.subscriptionId}`;
  }
  return { applied: true, balanceAfter };
}

/**
 * Nested-create fragment for prisma.user.create: records the account's
 * starting credits as a GRANT ledger row in the same INSERT as the account, so
 * a new wallet's balance always equals the sum of its ledger rows.
 */
export function startingGrant(amount: number, reason: "signup_grant" | "guest_trial_grant") {
  if (!(amount > 0)) return {};
  return {
    transactions: {
      create: {
        type: "GRANT" as const,
        amountCents: amount,
        description: reason === "signup_grant" ? "Starting credits for your new account" : "Trial credits",
        reason,
        balanceAfter: amount,
      },
    },
  };
}
