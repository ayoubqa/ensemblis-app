"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Tag, useToast, type TagVariant } from "@/components";
import { api, type Billing, type PlanId, type PublicConfig, type Subscription } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { credits, creditsNum, eur, longDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

const CONFIRM_MS = 30_000;
const POLL_MS = 2_500;

function statusTag(s: Subscription): { label: string; variant: TagVariant } {
  if (s.status === "checkout_pending") return { label: "Waiting for payment", variant: "gray" };
  if (s.status === "past_due" || s.status === "unpaid") return { label: "Payment failed", variant: "bad" };
  if (s.status === "incomplete") return { label: "Payment not completed", variant: "warn" };
  if (s.status === "canceled" || s.status === "incomplete_expired") return { label: "Ended", variant: "gray" };
  if (s.status === "paused") return { label: "Paused", variant: "warn" };
  if (s.cancelAtPeriodEnd) return { label: "Ends at renewal", variant: "warn" };
  return { label: "Active", variant: "ok" };
}

/**
 * The account's monthly plan on Usage: what it is, what is left of this month's plan credits, when it renews
 * or ends, and the actions the server allows. Everything shown comes from GET /api/billing; on the return from
 * Stripe Checkout it waits for the server to confirm the payment (by webhook) instead of assuming it.
 * Must be rendered inside <Suspense>.
 */
export function PlanPanel({ billing, config, onBilling }: { billing: Billing; config: PublicConfig; onBilling: (b: Billing) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { setUser } = useAuth();
  // The header shows the balance from the signed-in user: refresh it whenever the plan moves credits.
  const refreshUser = useCallback(() => api.me().then((r) => setUser(r.user)).catch(() => undefined), [setUser]);
  const [confirming, setConfirming] = useState(() => params.get("subscription") === "success");
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const deadline = useRef(Date.now() + CONFIRM_MS);
  const s = billing.subscription ?? null;
  const owner = billing.walletOwner === "self";

  // Clean the URL once, so a reload doesn't replay the return from Stripe.
  useEffect(() => {
    if (params.get("subscription") || params.get("portal")) router.replace(`${ROUTES.usage}#plan`, { scroll: false });
    if (params.get("portal")) api.billing().then(onBilling).catch(() => undefined); // changes made in billing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After checkout: poll until the server has the paid subscription, or say it is still being confirmed.
  useEffect(() => {
    if (!confirming) return;
    if (s?.entitled) {
      setConfirming(false);
      toast(`Your ${s.planName} plan is active: ${credits(s.allowanceRemaining)} added.`);
      refreshUser();
      return;
    }
    if (Date.now() > deadline.current) {
      setConfirming(false);
      setSlow(true);
      return;
    }
    const t = setTimeout(() => {
      api.billing().then(onBilling).catch(() => undefined);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [confirming, s, onBilling, toast, refreshUser]);

  const act = async (what: string, fn: () => Promise<{ billing: Billing }>, done: string) => {
    setBusy(what);
    try {
      const r = await fn();
      onBilling(r.billing);
      toast(done);
      refreshUser();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  };
  const redirect = async (what: string, fn: () => Promise<{ url: string }>) => {
    setBusy(what);
    try {
      window.location.assign((await fn()).url);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };

  const plans = (config.plans ?? []).filter((p) => p.available);
  const recheck = () => {
    setSlow(false);
    deadline.current = Date.now() + CONFIRM_MS;
    setConfirming(true);
    api.billing().then(onBilling).catch(() => undefined);
  };

  if (!s) {
    if (!owner) {
      return (
        <section id="plan" className="op-sec" aria-labelledby="h-plan">
          <div className="op-sec-head">
            <h2 id="h-plan">Plan</h2>
          </div>
          <div className="op-panel op-pad op-quiet">
            <Icon name="users" />
            Your organization&apos;s plan and credits are managed by its owner.
          </div>
        </section>
      );
    }
    if (!config.subscriptionsEnabled) return null; // prepaid credits only on this server
    return (
      <section id="plan" className="op-sec" aria-labelledby="h-plan">
        <div className="op-sec-head">
          <div>
            <h2 id="h-plan">Plan</h2>
            <p className="op-sec-sub">You&apos;re on prepaid credits. A monthly plan adds a credit allowance every month and raises the daily limit.</p>
          </div>
        </div>
        <div className="op-panel op-pad op-plan-empty">
          {confirming ? (
            <p role="status">
              <b>Confirming your payment with Stripe…</b> This usually takes a few seconds.
            </p>
          ) : slow ? (
            <p role="status">
              Stripe hasn&apos;t confirmed a payment yet. If you completed checkout, your plan appears here as soon as it does.{" "}
              <button type="button" className="op-link" onClick={recheck}>
                Check again
              </button>
            </p>
          ) : (
            <Link href={ROUTES.pricing} className="btn p sm">
              See plans
            </Link>
          )}
        </div>
      </section>
    );
  }

  const tag = statusTag(s);
  const live = ["trialing", "active", "past_due"].includes(s.status);
  const used = Math.max(0, s.allowanceGranted - s.allowanceRemaining);
  const share = s.allowanceGranted ? Math.min(100, Math.round((s.allowanceRemaining / s.allowanceGranted) * 100)) : 0;
  const others = plans.filter((p) => p.id !== s.planId);

  return (
    <section id="plan" className="op-sec" aria-labelledby="h-plan">
      <div className="op-sec-head">
        <div>
          <h2 id="h-plan">Plan</h2>
          <p className="op-sec-sub">Plan credits are used first and expire at the end of each billing month. Other credits never expire.</p>
        </div>
      </div>
      <div className="op-panel op-pad op-plan" data-testid="plan">
        <div className="op-plan-top">
          <div>
            <p className="op-plan-name">
              {s.planName} plan <Tag variant={tag.variant}>{tag.label}</Tag>
            </p>
            <p className="op-meta">
              {s.priceCents != null && `${eur(s.priceCents)} a month · `}
              {s.status === "checkout_pending"
                ? "Checkout was started but not paid."
                : s.endedAt
                  ? `Ended on ${longDate(s.endedAt)}.`
                  : s.paymentProblem
                    ? "The payment for this period is outstanding; Stripe is retrying it."
                    : s.cancelAtPeriodEnd && s.currentPeriodEnd
                    ? `Ends on ${longDate(s.currentPeriodEnd)}; it won't renew.`
                    : s.currentPeriodEnd
                      ? `Renews on ${longDate(s.currentPeriodEnd)}.`
                      : "Waiting for Stripe to confirm the billing period."}
            </p>
          </div>
          {s.entitled && <p className="op-meta">Up to {s.runsPerDay} executions a day per person</p>}
        </div>

        {confirming && !s.entitled && (
          <p className="op-note" role="status">
            <b>Confirming your payment with Stripe…</b> Plan credits are added once Stripe confirms it.
          </p>
        )}
        {slow && !s.entitled && (
          <p className="op-note" role="status">
            Stripe hasn&apos;t confirmed the payment yet; nothing has been added.{" "}
            <button type="button" className="op-link" onClick={recheck}>
              Check again
            </button>
          </p>
        )}
        {s.paymentProblem && (
          <p className="op-note is-bad" role="alert">
            <b>{s.status === "incomplete" ? "The first payment didn't go through." : "Your last payment failed."}</b> No new plan credits are added
            until it is paid; your other credits stay usable. Update your card in Billing; Stripe retries automatically.
          </p>
        )}
        {s.nextPlanName && (
          <p className="op-note">
            Changes to <b>{s.nextPlanName}</b> at the next renewal{s.currentPeriodEnd ? ` (${longDate(s.currentPeriodEnd)})` : ""}.{" "}
            {owner && (
              <button type="button" className="op-link" disabled={busy !== null} onClick={() => act("keep", () => api.changePlan(s.planId as PlanId), `You'll stay on ${s.planName}.`)}>
                Keep {s.planName}
              </button>
            )}
          </p>
        )}

        {(s.allowanceGranted > 0 || s.allowanceRemaining > 0) && (
          <div className="op-plan-credits">
            <div className="op-plan-meter">
              <span>
                <b>{creditsNum(s.allowanceRemaining)}</b> of {creditsNum(s.allowanceGranted)} plan credits left
              </span>
              <span className="op-meta">
                {credits(used)} used{s.allowancePeriodEnd ? ` · unused ones expire on ${longDate(s.allowancePeriodEnd)}` : ""}
              </span>
            </div>
            <span className="op-bar" role="progressbar" aria-label="Plan credits left" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
              <i style={{ width: `${share}%` }} />
            </span>
            <p className="op-meta">
              Other credits: <b>{credits(billing.credits?.otherCreditsCents ?? 0)}</b> (bought, starting or demo credits; they don&apos;t expire)
            </p>
          </div>
        )}

        {owner && (
          <div className="op-plan-actions">
            <button type="button" className="btn sm" disabled={busy !== null} onClick={() => redirect("portal", api.billingPortal)}>
              <Icon name="ext" />
              {busy === "portal" ? "Opening billing…" : "Manage billing"}
            </button>
            {live && !s.cancelAtPeriodEnd && !s.nextPlanId &&
              others.map((p) => {
                const up = p.monthlyCredits > (s.monthlyCredits ?? 0);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="btn sm"
                    disabled={busy !== null || s.status !== "active"}
                    title={up ? "Applies now: charged for the rest of this month, credits added for the rest of it" : "Starts at the next renewal"}
                    onClick={async () => {
                      await act(
                        `to-${p.id}`,
                        () => api.changePlan(p.id),
                        up ? `Upgrading to ${p.name}: the extra credits arrive once Stripe confirms the payment.` : `${p.name} starts at your next renewal.`
                      );
                      // An upgrade applies when Stripe confirms its prorated payment (by webhook): look again shortly.
                      if (up)
                        for (const ms of [3_000, 8_000])
                          setTimeout(() => {
                            api.billing().then(onBilling).catch(() => undefined);
                            refreshUser();
                          }, ms);
                    }}
                  >
                    {up ? "Upgrade" : "Downgrade"} to {p.name} ({eur(p.priceCents)})
                  </button>
                );
              })}
            {live && !s.cancelAtPeriodEnd &&
              (confirmCancel ? (
                <span className="op-inline">
                  <span className="op-meta">
                    Cancel? The plan stays until {s.currentPeriodEnd ? longDate(s.currentPeriodEnd) : "the end of this month"}, then stops renewing.
                  </span>
                  <button type="button" className="btn sm" disabled={busy !== null} onClick={() => act("cancel", api.cancelSubscription, "Your plan won't renew.")}>
                    {busy === "cancel" ? "Cancelling…" : "Yes, cancel"}
                  </button>
                  <button type="button" className="btn sm ghost" onClick={() => setConfirmCancel(false)}>
                    Keep plan
                  </button>
                </span>
              ) : (
                <button type="button" className="btn sm ghost" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
                  Cancel plan
                </button>
              ))}
            {live && s.cancelAtPeriodEnd && (
              <button type="button" className="btn sm" disabled={busy !== null} onClick={() => act("resume", api.resumeSubscription, `Your ${s.planName} plan will renew.`)}>
                Keep my plan
              </button>
            )}
            {!live && s.status !== "checkout_pending" && config.subscriptionsEnabled && (
              <Link href={ROUTES.pricing} className="btn p sm">
                Choose a plan
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
