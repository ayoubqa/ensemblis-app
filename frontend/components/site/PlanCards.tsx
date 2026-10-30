"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, type Plan, type PlanId, type Subscription } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { credits, eur } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { track } from "@/lib/analytics";
import { useStartHref } from "./StartLink";

const LIVE = new Set(["incomplete", "trialing", "active", "past_due", "unpaid", "paused"]);

/**
 * The monthly plans, from the server's catalogue (GET /api/config): nothing here decides a price. Shown only
 * while this server sells plans (SUBSCRIPTIONS_ENABLED and Stripe configured). The button starts Stripe
 * Checkout; the plan begins when Stripe confirms the first payment, never on the return to Ensemblis.
 * Must be rendered inside <Suspense> (it reads the query string).
 */
export function PlanCards() {
  const { config, loaded } = useConfig();
  const { user } = useAuth();
  const startHref = useStartHref();
  const params = useSearchParams();
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = params.get("subscription") === "cancelled";

  useEffect(() => {
    if (!user || user.isGuest) return;
    api
      .billing()
      .then((b) => setCurrent(b.subscription ?? null))
      .catch(() => setCurrent(null));
  }, [user]);

  const plans = config.plans ?? [];
  if (!loaded || !config.subscriptionsEnabled || plans.length === 0) return null;
  const hasPlan = !!current && LIVE.has(current.status);

  const subscribe = async (plan: Plan) => {
    setError(null);
    setBusy(plan.id);
    track("cta_click", { from: "pricing-plan", to: `checkout:${plan.id}` });
    try {
      const { url } = await api.startSubscription(plan.id);
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message || "Checkout couldn't start. Please try again.");
      setBusy(null);
    }
  };

  return (
    <section className="st-sec" aria-labelledby="pr-plans">
      <div className="wrap">
        <header className="st-head">
          <h2 id="pr-plans">Monthly plans</h2>
          <p className="st-lead">
            A plan adds a credit allowance every month and raises the daily limit. The work itself is priced exactly as below: every step in credits,
            approved before it runs.
          </p>
        </header>
        {cancelled && (
          <p className="st-plan-note" role="status">
            Checkout was cancelled. Nothing was charged.
          </p>
        )}
        <ul className="st-plans">
          {plans.map((p) => {
            const mine = hasPlan && current?.planId === p.id;
            return (
              <li key={p.id} className={`st-price-card st-plan${mine ? " is-current" : ""}`}>
                <h3>{p.name}</h3>
                <p className="st-plan-price">
                  <b>{eur(p.priceCents)}</b> a month
                </p>
                <ul className="st-beta">
                  <li>{credits(p.monthlyCredits)} each month</li>
                  <li>Up to {p.runsPerDay} executions a day per person</li>
                  <li>Approvals, verification, reports and export, as on every account</li>
                </ul>
                <div className="st-plan-cta">
                  {mine ? (
                    <Link href={`${ROUTES.usage}#plan`} className="btn">
                      Your plan
                    </Link>
                  ) : !p.available ? (
                    <button type="button" className="btn" disabled>
                      Not available yet
                    </button>
                  ) : !user ? (
                    <Link href={startHref} className="btn p" onClick={() => track("cta_click", { from: "pricing-plan", to: startHref })}>
                      Get started
                    </Link>
                  ) : hasPlan ? (
                    <Link href={`${ROUTES.usage}#plan`} className="btn">
                      Change plan in Usage
                    </Link>
                  ) : (
                    <button type="button" className="btn p" onClick={() => subscribe(p)} disabled={busy !== null} aria-busy={busy === p.id}>
                      {busy === p.id ? "Opening checkout…" : `Choose ${p.name}`}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {error && (
          <p className="st-plan-error" role="alert">
            <Icon name="alert" size={16} />
            {error}
          </p>
        )}
        <ul className="st-plan-rules">
          <li>
            <b>Plan credits first.</b> Executions use the month&apos;s plan credits before anything else. Plan credits you don&apos;t use expire at the
            end of the billing month.
          </li>
          <li>
            <b>Other credits keep.</b> Credits you bought or were given never expire, with or without a plan.
          </li>
          <li>
            <b>Cancel any time.</b> The plan runs to the end of the month you paid for. Upgrades apply at once, charged for the rest of the month;
            downgrades start at the next renewal.
          </li>
          <li>
            <b>Paid through Stripe.</b> Card details are entered on Stripe&apos;s checkout page; Ensemblis never sees them.
          </li>
        </ul>
      </div>
    </section>
  );
}
