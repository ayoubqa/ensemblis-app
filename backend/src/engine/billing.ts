// Money for executions. Every movement goes through lib/wallet.ts (atomic
// conditional debit, ledger row per movement); this file only decides WHEN
// and HOW MUCH:
//   - charge: once, when an execution starts (after approval when one is
//     needed), for the planned estimate; inside the same transaction as the
//     status flip and the daily-cap check, so it can't double-charge;
//   - refund: on failure (everything not yet refunded), on cancellation (the
//     work that never ran), always capped at what was charged.
// The wallet is the organization owner's balance (the existing team-wallet rule).

import type { Prisma } from "@prisma/client";
import { config } from "../config";
import { HttpError } from "../lib/http";
import { assertDailyQuotaInTx } from "../lib/usageLimits";
import { creditWallet, debitWallet, type WalletRef } from "../lib/wallet";

type Tx = Prisma.TransactionClient;

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

export async function orgWallet(tx: Tx, orgId: string, actorUserId: string): Promise<WalletRef> {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { ownerId: true, teamId: true } });
  return { walletUserId: org.ownerId, teamId: org.teamId, via: org.teamId && org.ownerId !== actorUserId ? "team" : "self" };
}

/** Guest trial accounts may start config.guest.maxTasks paid runs in total. */
async function assertGuestAllowance(tx: Tx, actorUserId: string): Promise<void> {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isGuest: true } });
  if (!actor?.isGuest) return;
  const runs = await tx.transaction.count({
    where: { type: "TASK_CHARGE", OR: [{ actorUserId }, { actorUserId: null, userId: actorUserId }] },
  });
  if (runs >= config.guest.maxTasks) {
    const n = config.guest.maxTasks;
    throw new HttpError(403, `Create a free account to run more objectives — the free trial includes ${n} execution${n === 1 ? "" : "s"}. Everything from your trial is kept.`);
  }
}

/** Debits the execution's estimate. Must run inside the transaction that flips it to RUNNING. */
export async function chargeExecution(
  tx: Tx,
  args: { executionId: string; orgId: string; actorUserId: string; amountCents: number; title: string }
): Promise<WalletRef> {
  await assertDailyQuotaInTx(tx, args.actorUserId);
  await assertGuestAllowance(tx, args.actorUserId);
  const wallet = await orgWallet(tx, args.orgId, args.actorUserId);
  await debitWallet(tx, {
    wallet,
    actorUserId: args.actorUserId,
    amountCents: args.amountCents,
    description: `Execution: ${args.title}`.slice(0, 200),
    executionId: args.executionId,
  });
  await tx.execution.update({
    where: { id: args.executionId },
    data: { costCents: args.amountCents, walletUserId: wallet.walletUserId, chargedAt: new Date() },
  });
  return wallet;
}

/**
 * Refunds up to `amountCents`, never more than what is still unrefunded.
 * The execution row is locked first (guarded update), so concurrent refunds
 * can't exceed the charge. Returns the amount refunded.
 */
export async function refundExecution(tx: Tx, executionId: string, amountCents: number, reason: string): Promise<number> {
  if (amountCents <= 0) return 0;
  const rows = await tx.$queryRaw<{ costCents: number; refundedCents: number; walletUserId: string | null; orgId: string }[]>`
    SELECT "costCents", "refundedCents", "walletUserId", "orgId" FROM "Execution" WHERE "id" = ${executionId} FOR UPDATE`;
  const ex = rows[0];
  if (!ex || !ex.walletUserId) return 0;
  const refundable = Math.max(0, ex.costCents - ex.refundedCents);
  const amount = Math.min(refundable, Math.round(amountCents));
  if (amount <= 0) return 0;
  let walletUserId = ex.walletUserId;
  if (!(await tx.user.findUnique({ where: { id: walletUserId }, select: { id: true } }))) {
    const org = await tx.organization.findUnique({ where: { id: ex.orgId }, select: { ownerId: true } });
    if (!org) return 0;
    walletUserId = org.ownerId;
  }
  await creditWallet(tx, { walletUserId, actorUserId: null, type: "REFUND", amountCents: amount, description: `Refund: ${reason}`.slice(0, 200), executionId });
  await tx.execution.update({ where: { id: executionId }, data: { refundedCents: { increment: amount } } });
  return amount;
}

export { eur };
