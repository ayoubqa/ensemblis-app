-- Monthly subscriptions (additive only: new tables and nullable columns, no rewrites, no balance changes).
-- "User"."credits" stays the only spendable balance. A subscription's unused allowance is tracked on its
-- row as the part of that balance that expires, and every ledger row records how much of it moved the
-- allowance ("allowanceCents"), so the allowance can be reconciled against the ledger like the balance.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "allowanceCents" INTEGER,
ADD COLUMN "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "walletUserId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "nextPlanId" TEXT,
    "status" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "checkoutUrl" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "allowanceCredits" INTEGER NOT NULL DEFAULT 0,
    "allowanceGranted" INTEGER NOT NULL DEFAULT 0,
    "allowancePeriodStart" TIMESTAMP(3),
    "allowancePeriodEnd" TIMESTAMP(3),
    "lastPaymentError" TEXT,
    "stripeSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "eventCreated" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Transaction_subscriptionId_idx" ON "Transaction"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCheckoutSessionId_key" ON "Subscription"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_walletUserId_createdAt_idx" ON "Subscription"("walletUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Subscription_allowancePeriodEnd_idx" ON "Subscription"("allowancePeriodEnd");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_walletUserId_fkey" FOREIGN KEY ("walletUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
