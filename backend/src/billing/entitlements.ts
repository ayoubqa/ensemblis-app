// What a wallet's plan entitles it to, decided in one place and enforced by the backend (the frontend only
// shows what the API returns). Today a plan changes one limit: executions per user per UTC day, which a plan
// can raise above the prepaid limit (MAX_TASKS_PER_USER_PER_DAY) but never lower. Planning per organization
// scales with it. Server-wide caps, credit checks and the execution cost guards apply to every plan.
//
// Seat and recurring-objective limits are deliberately NOT plan-based: prepaid accounts have none, so a plan
// limit would leave a paying customer with less than a prepaid one.
//
// A plan counts only while its subscription is paid up: Stripe status active or trialing, or past_due while
// SUBSCRIPTION_PAST_DUE_ACCESS=keep (the default; Stripe is still retrying the payment). Anything else, an
// unknown plan id included, gets the prepaid limits.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { planById, type Plan } from "./plans";

type Db = PrismaClient | Prisma.TransactionClient;

/** Stripe subscription statuses under which the plan's limits apply. */
export function entitledStatuses(): string[] {
  return config.subscriptions.pastDueAccess === "keep" ? ["active", "trialing", "past_due"] : ["active", "trialing"];
}

export interface Entitlements {
  /** The plan in force, or null (prepaid limits). */
  plan: Plan | null;
  runsPerDay: number;
  plansPerDay: number;
}

export function entitlementsForPlan(plan: Plan | null): Entitlements {
  const runsPerDay = plan ? Math.max(plan.runsPerDay, config.maxTasksPerUserPerDay) : config.maxTasksPerUserPerDay;
  return { plan, runsPerDay, plansPerDay: plan ? Math.max(config.planning.perOrgPerDay, 4 * runsPerDay) : config.planning.perOrgPerDay };
}

export async function entitlementsFor(db: Db, walletUserId: string): Promise<Entitlements> {
  const sub = await db.subscription.findFirst({
    where: { walletUserId, stripeSubscriptionId: { not: null }, status: { in: entitledStatuses() } },
    orderBy: { createdAt: "desc" },
    select: { planId: true },
  });
  return entitlementsForPlan(planById(sub?.planId));
}

export async function walletEntitlements(walletUserId: string): Promise<Entitlements> {
  return entitlementsFor(prisma, walletUserId);
}
