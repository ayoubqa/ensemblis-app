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

/**
 * Add funds through Stripe Checkout. Only rendered when config.paymentsEnabled.
 * Each option states two facts from the server config: what you pay and what
 * is added to the balance. No tiers, badges or upsell.
 */
export function AddFunds({ packs, transactions, orgName }: { packs: CreditPack[]; transactions: Transaction[] | null; orgName?: string | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const pay = async (p: CreditPack) => {
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
  const options = [...packs].sort((a, b) => a.priceCents - b.priceCents);

  return (
    <div className="op-panel op-pad">
      <div className="op-inline" style={{ justifyContent: "space-between" }}>
        <p className="op-sec-sub" style={{ marginTop: 0 }}>
          Choose an amount.{orgName ? ` Funds go into the ${orgName} organization balance.` : ""}
        </p>
        <span className="tag gray">
          <Icon name="lock" />
          Secure checkout
        </span>
      </div>
      <ul className="op-funds" aria-label="Amounts you can add">
        {options.map((p) => (
          <li key={p.id}>
            <div className="op-fund">
              <span className="op-kpi-l">Added to your balance</span>
              <span className="op-fund-v">{eur(p.credits, { decimals: p.credits % 100 !== 0 })}</span>
              <span className="op-meta">
                You pay {eur(p.priceCents, { decimals: p.priceCents % 100 !== 0 })}
              </span>
              <button
                type="button"
                className="btn block"
                onClick={() => pay(p)}
                disabled={!!busy}
                aria-busy={busy === p.id}
                aria-label={`Add ${eur(p.credits)} to your balance for ${eur(p.priceCents)}`}
              >
                Pay {eur(p.priceCents)}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="op-secure">
        <Icon name="shield" />
        <span>
          Payments are processed by Stripe. You finish on Stripe&apos;s secure checkout page — Ensemblis never sees or stores your card details. Funds are
          added as soon as Stripe confirms the payment. See our <Link href={ROUTES.terms}>Terms</Link> and <Link href={ROUTES.privacy}>Privacy Policy</Link>.
        </span>
      </p>
    </div>
  );
}
