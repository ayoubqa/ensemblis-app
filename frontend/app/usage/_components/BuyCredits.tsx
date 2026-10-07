"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, useToast } from "@/components";
import { api, type CreditPack, type Transaction } from "@/lib/api";
import { toastApiError } from "@/lib/errors";
import { eur } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { storage } from "@/lib/utils";

export const CHECKOUT_KEY = "ens.checkout.pending";

/** Saved before redirecting to Stripe so the return page can spot the new purchase. */
export interface PendingCheckout {
  at: number;
  packId: string;
  known: string[]; // PURCHASE transaction ids that existed before checkout
}

export function bonusPercent(p: CreditPack): number {
  if (!p.priceCents || p.credits <= p.priceCents) return 0;
  return Math.round(((p.credits - p.priceCents) / p.priceCents) * 100);
}

/** Stripe Checkout funding packs. Only rendered when config.paymentsEnabled. */
export function BuyCredits({ packs, transactions, teamName }: { packs: CreditPack[]; transactions: Transaction[] | null; teamName?: string | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const buy = async (p: CreditPack) => {
    setBusy(p.id);
    try {
      const { url } = await api.createCheckout(p.id);
      if (!/^https:\/\//i.test(url) && !/^http:\/\/localhost[:/]/i.test(url)) throw new Error("The payment page link looks wrong. Please try again.");
      const pending: PendingCheckout = {
        at: Date.now(),
        packId: p.id,
        known: (transactions ?? []).filter((t) => t.type === "PURCHASE").map((t) => t.id),
      };
      storage.set(CHECKOUT_KEY, JSON.stringify(pending));
      window.location.href = url;
      // Keep the spinner while the browser navigates away.
    } catch (e) {
      toastApiError(toast, e, "Couldn't open the payment page");
      setBusy(null);
    }
  };

  if (!packs.length) return null;

  return (
    <section id="buy" className="card" style={{ marginTop: 16, scrollMarginTop: 90 }} aria-labelledby="h-buy">
      <div className="row between wrapflex" style={{ gap: 10 }}>
        <div>
          <h3 id="h-buy" style={{ margin: 0 }}>
            Add funds
          </h3>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Your balance pays for executions (charged when one starts, refunded for work that fails or never runs).{teamName ? ` Funds go into the ${teamName} organization balance.` : ""}
          </p>
        </div>
        <span className="tag gray">
          <Icon name="lock" />
          Secure checkout
        </span>
      </div>

      <div className="grid g3" style={{ marginTop: 16, alignItems: "stretch" }}>
        {packs.map((p) => {
          const bonus = bonusPercent(p);
          return (
            <div
              key={p.id}
              className="card tight"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                position: "relative",
                ...(p.popular ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : {}),
              }}
            >
              <div className="row between" style={{ gap: 8 }}>
                <b>{p.label}</b>
                {p.popular && (
                  <span className="tag">
                    <Icon name="star" />
                    Popular
                  </span>
                )}
              </div>
              <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.1 }}>{eur(p.priceCents)}</div>
              <div className="small">
                <b>{eur(p.credits)}</b> <span className="muted">added to your balance</span>
              </div>
              <div style={{ minHeight: 24 }}>
                {bonus > 0 ? (
                  <span className="tag ok">+{bonus}% bonus</span>
                ) : (
                  <span className="tiny muted">Balance matches what you pay</span>
                )}
              </div>
              <button
                type="button"
                className={p.popular ? "btn p block" : "btn block"}
                style={{ marginTop: "auto" }}
                onClick={() => buy(p)}
                disabled={!!busy}
                aria-busy={busy === p.id}
                aria-label={`Buy the ${p.label} pack: ${eur(p.credits)} added to your balance for ${eur(p.priceCents)}`}
              >
                Buy for {eur(p.priceCents)}
              </button>
            </div>
          );
        })}
      </div>

      <p className="tiny muted row" style={{ marginTop: 14, gap: 8, alignItems: "flex-start" }}>
        <Icon name="shield" size={14} style={{ flex: "none", marginTop: 1 }} />
        <span>
          Payments are processed by Stripe. You&apos;ll finish on Stripe&apos;s secure checkout page — Ensemblis never sees or stores your card
          details. Funds are added as soon as Stripe confirms the payment. See our{" "}
          <Link href={ROUTES.terms} style={{ color: "var(--accent)" }}>
            Terms
          </Link>{" "}
          and{" "}
          <Link href={ROUTES.privacy} style={{ color: "var(--accent)" }}>
            Privacy Policy
          </Link>
          .
        </span>
      </p>
    </section>
  );
}
