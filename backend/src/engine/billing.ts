// Money for executions. Every movement goes through lib/wallet.ts (atomic
// conditional debit, ledger row per movement); this file only decides WHEN
// and HOW MUCH:
//   - charge: once, when an execution starts (after approval when one is
//     needed), for the planned estimate; inside the same transaction as the
//     status flip and the daily-cap check, so it can't double-charge;
//   - refund: on failure (everything not yet refunded), on cancellation (the
//     work that never ran), always capped at what was charged. Plan credits
//     the charge took from a subscription allowance come back as plan credits
//     (while that billing period lasts), the rest as ordinary credits.
// The wallet is the organization owner's balance (the existing team-wallet rule).

import type { Prisma } from "@prisma/client";
import { config } from "../config";
import { HttpError } from "../lib/http";
import { assertDailyQuotaInTx } from "../lib/usageLimits";
import { creditWallet, debitWallet, expireRefundedAllowance, lockWallet, type WalletRef } from "../lib/wallet";
import { entitlementsFor } from "../billing/entitlements";
import { formatCredits, LEDGER_REASONS } from "../billing/credits";

type Tx = Prisma.TransactionClient;

/** Why an execution's credits come back (Transaction.reason). */
export type RefundReason = "step_skipped" | "execution_failed" | "execution_cancelled" | "verification_unavailable";

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
  const wallet = await orgWallet(tx, args.orgId, args.actorUserId);
  // The paying wallet's plan sets the per-user daily limit (never below the prepaid one); global caps still apply.
  const { runsPerDay } = await entitlementsFor(tx, wallet.walletUserId);
  await assertDailyQuotaInTx(tx, args.actorUserId, { runsPerDay });
  await assertGuestAllowance(tx, args.actorUserId);
  await debitWallet(tx, {
    wallet,
    actorUserId: args.actorUserId,
    amountCents: args.amountCents,
    description: `Execution: ${args.title}`.slice(0, 200),
    executionId: args.executionId,
    reason: "execution_charge",
    // One charge per execution, enforced by the database too (startInTx already flips the status only once).
    idempotencyKey: `charge:${args.executionId}`,
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
export async function refundExecution(tx: Tx, executionId: string, amountCents: number, reason: RefundReason, detail?: string): Promise<number> {
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
  // Which part of this refund is plan credits. The charge spent allowance first, so refunds give the other
  // credits back first (last spent, first returned); the remainder goes back to the allowance it came from.
  const charge = await tx.transaction.findUnique({
    where: { idempotencyKey: `charge:${executionId}` },
    select: { allowanceCents: true, subscriptionId: true, createdAt: true },
  });
  const fromAllowance = Math.max(0, -(charge?.allowanceCents ?? 0));
  const otherCharged = ex.costCents - fromAllowance;
  const otherShare = Math.min(amount, Math.max(0, otherCharged - Math.min(ex.refundedCents, otherCharged)));
  const allowanceShare = charge?.subscriptionId ? amount - otherShare : 0;
  let restore: { subscriptionId: string; cents: number } | null = null;
  let expired = 0;
  if (allowanceShare > 0 && charge?.subscriptionId) {
    await lockWallet(tx, walletUserId);
    const sub = await tx.subscription.findUnique({
      where: { id: charge.subscriptionId },
      select: { walletUserId: true, allowancePeriodStart: true, allowancePeriodEnd: true },
    });
    // Back into the same paid period's allowance only while that period lasts; otherwise it has expired.
    const samePeriod =
      !!sub &&
      sub.walletUserId === walletUserId &&
      !!sub.allowancePeriodEnd &&
      sub.allowancePeriodEnd > new Date() &&
      (!sub.allowancePeriodStart || charge.createdAt >= sub.allowancePeriodStart);
    if (samePeriod) restore = { subscriptionId: charge.subscriptionId, cents: allowanceShare };
    else expired = allowanceShare;
  }
  await creditWallet(tx, {
    walletUserId,
    actorUserId: null,
    type: "REFUND",
    amountCents: amount,
    description: (detail ? `Refund: ${detail}` : LEDGER_REASONS[reason]).slice(0, 200),
    executionId,
    reason,
    allowance: restore,
  });
  if (expired > 0 && charge?.subscriptionId) {
    await expireRefundedAllowance(tx, { walletUserId, subscriptionId: charge.subscriptionId, cents: expired, executionId });
  }
  await tx.execution.update({ where: { id: executionId }, data: { refundedCents: { increment: amount } } });
  return amount;
}

export { formatCredits };
