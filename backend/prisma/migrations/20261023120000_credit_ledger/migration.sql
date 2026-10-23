-- Ensemblis credits, part 1 (additive only: no drops, no rewrites, no balance changes).
-- New ledger types, three nullable ledger columns (reason, balance after the movement,
-- idempotency key with a unique index), and nullable cost-accounting columns on UsageEvent.
-- Balances stay in "User"."credits": the stored integer is now read as credits
-- (1 credit = €0.01 of credit value at CREDITS_PER_EUR = 100, the rate it was issued at).

ALTER TYPE "TransactionType" ADD VALUE 'GRANT';
ALTER TYPE "TransactionType" ADD VALUE 'ADJUSTMENT';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "balanceAfter" INTEGER,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "attempts" INTEGER,
ADD COLUMN     "cachedTokensIn" INTEGER,
ADD COLUMN     "costCurrency" TEXT,
ADD COLUMN     "costMicros" INTEGER,
ADD COLUMN     "costSource" TEXT,
ADD COLUMN     "stepId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

