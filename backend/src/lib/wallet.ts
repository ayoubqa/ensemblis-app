// Wallets (v3). Every credit movement in the app goes through this file.
//
// A user's spendable balance is either their own User.credits ("self") or,
// when they belong to a team, the team OWNER's User.credits ("team"). A
// member's personal balance is untouched — and unused — while they are in a
// team. Transaction.userId is always the WALLET whose balance changed;
// Transaction.actorUserId is the person who triggered it.

import type { Prisma, PrismaClient, TransactionType } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "./http";

type Db = PrismaClient | Prisma.TransactionClient;

export interface WalletRef {
  walletUserId: string; // whose User.credits is debited/credited
  teamId: string | null; // the team, when paying from a team wallet
  via: "self" | "team";
}

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

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

/**
 * Atomically debits `amountCents` from the wallet (conditional decrement — safe
 * under concurrency) and records a TASK_CHARGE. Throws 402 if it can't afford it.
 * Must be called inside a prisma.$transaction.
 */
export async function debitWallet(
  tx: Prisma.TransactionClient,
  args: { wallet: WalletRef; actorUserId: string; amountCents: number; description: string; taskId?: string | null; executionId?: string | null }
): Promise<void> {
  const { wallet, actorUserId, amountCents, description, taskId, executionId } = args;
  if (amountCents < 0) throw new Error("debitWallet: amount must be >= 0");
  if (amountCents > 0) {
    const res = await tx.user.updateMany({
      where: { id: wallet.walletUserId, credits: { gte: amountCents } },
      data: { credits: { decrement: amountCents } },
    });
    if (res.count === 0) {
      const owner = await tx.user.findUnique({ where: { id: wallet.walletUserId }, select: { credits: true } });
      if (!owner) throw new HttpError(401, "Account no longer exists");
      const whose = wallet.via === "team" ? "your team's balance" : "your balance";
      throw new HttpError(
        402,
        `Insufficient credits: this costs ${eur(amountCents)} and ${whose} is ${eur(owner.credits)}. ` +
          (wallet.via === "team" ? "Ask your team owner to top up in Billing." : "Top up in Billing to continue.")
      );
    }
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
    },
  });
}

/** Credits a wallet (refund / demo top-up / Stripe purchase) and records it. Use inside a transaction. */
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
  }
): Promise<void> {
  const { walletUserId, actorUserId, type, amountCents, description, taskId, executionId } = args;
  if (amountCents <= 0) return;
  await tx.user.update({ where: { id: walletUserId }, data: { credits: { increment: amountCents } } });
  await tx.transaction.create({
    data: { userId: walletUserId, actorUserId, type, amountCents, description, taskId: taskId ?? null, executionId: executionId ?? null },
  });
}
