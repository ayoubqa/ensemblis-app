// Ledger integrity. The balance in User.credits is the fast path; the
// Transaction rows are the audit trail, and for every wallet they must agree:
//   User.credits = SUM(Transaction.amountCents WHERE userId = wallet)
// The 20261023120100 migration recorded every pre-existing balance difference
// once as an "opening balance"; from then on lib/wallet.ts writes a row for
// every movement. This file checks the invariant (hourly, from maintenance,
// and on the owner dashboard) and repairs only the one unambiguous gap: an
// account with a balance and no ledger rows at all, which can only be one
// created by the previous release during a deploy (its starting credits were
// never recorded). Anything else is reported, never "fixed".

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { log } from "./log";

type Db = PrismaClient | Prisma.TransactionClient;

export interface LedgerMismatch {
  walletUserId: string;
  balance: number;
  ledgerSum: number;
}

/** Wallets whose balance differs from the sum of their ledger rows (first `limit`), and how many wallets were checked. */
export async function reconcileWallets(db: Db = prisma, limit = 50): Promise<{ checked: number; mismatches: LedgerMismatch[]; mismatchCount: number }> {
  const [{ checked }] = await db.$queryRaw<{ checked: number }[]>`SELECT COUNT(*)::int AS checked FROM "User"`;
  const rows = await db.$queryRaw<{ walletUserId: string; balance: number; ledgerSum: number }[]>`
    SELECT u."id" AS "walletUserId", u."credits" AS "balance", COALESCE(t."sum", 0)::int AS "ledgerSum"
    FROM "User" u
    LEFT JOIN (SELECT "userId", SUM("amountCents")::int AS "sum" FROM "Transaction" GROUP BY "userId") t ON t."userId" = u."id"
    WHERE u."credits" <> COALESCE(t."sum", 0)
    ORDER BY u."createdAt"`;
  return { checked, mismatches: rows.slice(0, limit), mismatchCount: rows.length };
}

/**
 * Records the balance of accounts that have credits but NO ledger row at all
 * as their opening balance (same row shape and idempotency key as the
 * migration). Returns how many rows were written.
 */
export async function recordUnrecordedOpeningBalances(db: Db = prisma): Promise<number> {
  return db.$executeRaw`
    INSERT INTO "Transaction" ("id", "userId", "actorUserId", "type", "amountCents", "description", "reason", "balanceAfter", "idempotencyKey", "createdAt")
    SELECT 'opening_' || u."id", u."id", NULL, 'ADJUSTMENT', u."credits",
           'Opening balance: credits you already had, carried over unchanged when the credit ledger was introduced',
           'opening_balance', NULL, 'opening:' || u."id", u."createdAt"
    FROM "User" u
    WHERE u."credits" <> 0 AND NOT EXISTS (SELECT 1 FROM "Transaction" t WHERE t."userId" = u."id")
    ON CONFLICT ("idempotencyKey") DO NOTHING`;
}

/**
 * Subscriptions whose unused allowance disagrees with the ledger (allowanceCredits = SUM(allowanceCents)), or
 * exceeds the wallet's balance (the allowance is part of it). Read-only: a mismatch is reported, never "fixed".
 */
export async function reconcileAllowances(db: Db = prisma, limit = 50): Promise<{ id: string; allowance: number; ledgerSum: number; balance: number }[]> {
  return db.$queryRaw<{ id: string; allowance: number; ledgerSum: number; balance: number }[]>`
    SELECT s."id", s."allowanceCredits" AS "allowance", COALESCE(t."sum", 0)::int AS "ledgerSum", u."credits" AS "balance"
    FROM "Subscription" s
    JOIN "User" u ON u."id" = s."walletUserId"
    LEFT JOIN (SELECT "subscriptionId", SUM("allowanceCents")::int AS "sum" FROM "Transaction" WHERE "subscriptionId" IS NOT NULL GROUP BY "subscriptionId") t
      ON t."subscriptionId" = s."id"
    WHERE s."allowanceCredits" <> COALESCE(t."sum", 0) OR s."allowanceCredits" > u."credits" OR s."allowanceCredits" < 0
    LIMIT ${limit}`;
}

/** Hourly from maintenance: repair the unambiguous gap, then report anything that still disagrees. */
export async function checkLedger(): Promise<void> {
  const recorded = await recordUnrecordedOpeningBalances();
  if (recorded > 0) log.info("ledger.opening_balances_recorded", { wallets: recorded });
  const { checked, mismatchCount, mismatches } = await reconcileWallets(prisma, 5);
  if (mismatchCount > 0) {
    log.warn("ledger.mismatch", {
      checked,
      mismatches: mismatchCount,
      sample: mismatches.map((m) => `${m.walletUserId}:${m.balance}/${m.ledgerSum}`).join(","),
    });
  }
  const allowances = await reconcileAllowances(prisma, 5);
  if (allowances.length > 0) {
    log.warn("ledger.allowance_mismatch", { sample: allowances.map((a) => `${a.id}:${a.allowance}/${a.ledgerSum}/${a.balance}`).join(",") });
  }
}
