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

/** A ledger row already recorded under `key` (the movement was applied before), or null. */
async function alreadyApplied(tx: Prisma.TransactionClient, key: string | null | undefined) {
  if (!key) return null;
  return tx.transaction.findUnique({ where: { idempotencyKey: key }, select: { id: true, balanceAfter: true } });
}

/**
 * Atomically debits `amountCents` credits from the wallet (conditional
 * decrement — safe under concurrency) and records a TASK_CHARGE. Throws 402 if
 * it can't afford it. With an idempotency key, a repeat is a no-op (and the
 * unique key stops a concurrent duplicate). Must be called inside a
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
  if (amountCents > 0) {
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
    },
  });
  return { applied: true, balanceAfter };
}

/**
 * Credits a wallet (refund, demo top-up, Stripe purchase, grant, adjustment)
 * and records it. With an idempotency key, a repeat is a no-op. Use inside a
 * transaction.
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
  }
): Promise<{ applied: boolean; balanceAfter: number | null }> {
  const { walletUserId, actorUserId, type, amountCents, description, taskId, executionId } = args;
  if (!Number.isInteger(amountCents)) throw new Error("creditWallet: amount must be a whole number");
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
    },
  });
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
