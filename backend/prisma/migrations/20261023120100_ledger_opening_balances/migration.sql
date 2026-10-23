-- Ensemblis credits, part 2 (data only: no schema change, no balance change).
-- Before this release, starting credits (sign-up, guest trial) were written straight to
-- "User"."credits" without a ledger row, so a wallet's balance could not be reconciled
-- against "Transaction". For every wallet whose balance differs from the sum of its ledger
-- rows, record that difference ONCE as an ADJUSTMENT "opening balance" row, dated at the
-- account's creation. Afterwards, for every wallet: credits = SUM("amountCents").
-- Deterministic ids and the unique idempotency key make it safe to run again.
INSERT INTO "Transaction" ("id", "userId", "actorUserId", "type", "amountCents", "description", "reason", "balanceAfter", "idempotencyKey", "createdAt")
SELECT
  'opening_' || u."id",
  u."id",
  NULL,
  'ADJUSTMENT',
  u."credits" - COALESCE(t."sum", 0),
  'Opening balance: credits you already had, carried over unchanged when the credit ledger was introduced',
  'opening_balance',
  NULL,
  'opening:' || u."id",
  u."createdAt"
FROM "User" u
LEFT JOIN (SELECT "userId", SUM("amountCents")::int AS "sum" FROM "Transaction" GROUP BY "userId") t ON t."userId" = u."id"
WHERE u."credits" - COALESCE(t."sum", 0) <> 0
ON CONFLICT ("idempotencyKey") DO NOTHING;
