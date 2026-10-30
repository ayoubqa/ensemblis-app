// The subscription plan catalogue: the one place prices, monthly allowances and plan limits come from.
// Values live in config.subscriptions.plans (env-overridable); the frontend gets them from GET /api/config
// and the backend decides every price, allowance and limit — never the client.
//
// A plan is purchasable ("available") only when subscriptions are switched on, Stripe is configured and the
// plan has a Stripe recurring Price ID. Checkout also verifies, against Stripe, that the Price charges
// exactly priceCents in EUR per month (billing/subscriptions.ts), so the page can't show one price and
// Stripe bill another.

import { config } from "../config";

export type PlanId = "starter" | "growth" | "business";

export interface Plan {
  id: PlanId;
  name: string;
  /** EUR cents per month. */
  priceCents: number;
  /** Credits granted for each paid month; unused allowance expires at the end of that month. */
  monthlyCredits: number;
  /** Executions per user per UTC day while the plan is active (never below the prepaid limit). */
  runsPerDay: number;
  stripePriceId: string;
  stripeProductId: string;
}

export function plans(): Plan[] {
  return config.subscriptions.plans as Plan[];
}

export function subscriptionsAvailable(): boolean {
  return config.subscriptions.enabled && config.stripe.enabled;
}

export function planAvailable(plan: Plan): boolean {
  return subscriptionsAvailable() && !!plan.stripePriceId;
}

/** The plan with this id, or null (unknown ids never fall back to a default plan). */
export function planById(id: string | null | undefined): Plan | null {
  return plans().find((p) => p.id === id) ?? null;
}

/** The plan billed with this Stripe Price, or null. */
export function planByPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  return plans().find((p) => p.stripePriceId === priceId) ?? null;
}

/** What GET /api/config shows: no Stripe IDs, nothing secret. */
export function publicPlans() {
  return plans().map((p) => ({
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    currency: "eur" as const,
    monthlyCredits: p.monthlyCredits,
    runsPerDay: Math.max(p.runsPerDay, config.maxTasksPerUserPerDay),
    available: planAvailable(p),
  }));
}
