"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, useToast } from "@/components";
import { api, type Billing, type Transaction } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { storage } from "@/lib/utils";
import { CHECKOUT_KEY, type PendingCheckout } from "./BuyCredits";

const WAIT_MS = 20_000;

function readPending(): PendingCheckout | null {
  try {
    const raw = storage.get(CHECKOUT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingCheckout;
    return typeof p?.at === "number" && Array.isArray(p.known) ? p : null;
  } catch {
    return null;
  }
}

type State = "waiting" | "done" | "slow" | "cancelled" | null;

/**
 * Handles the return from Stripe Checkout (/usage?checkout=success|cancelled;
 * older links via /billing redirect here). Funds arrive by webhook, so on success it polls billing + me for up to ~20s
 * until the new PURCHASE shows up. Must be rendered inside <Suspense>.
 */
export function CheckoutBanner({ onBilling }: { onBilling: (b: Billing) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { setUser } = useAuth();
  const [state, setState] = useState<State>(() => {
    const c = params.get("checkout");
    return c === "success" ? "waiting" : c === "cancelled" || c === "cancel" || c === "canceled" ? "cancelled" : null;
  });
  const [amount, setAmount] = useState<number | null>(null);
  const deadline = useRef(Date.now() + WAIT_MS);
  const pending = useRef<PendingCheckout | null>(null);

  // Capture the pending checkout once, then clean the URL so a reload doesn't replay the banner.
  useEffect(() => {
    pending.current = readPending();
    if (state === "cancelled") storage.set(CHECKOUT_KEY, null);
    if (params.get("checkout")) router.replace(ROUTES.usage, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isNew = (t: Transaction) => {
    if (t.type !== "PURCHASE") return false;
    const at = new Date(t.createdAt).getTime();
    const p = pending.current;
    if (p) return !p.known.includes(t.id) && at >= p.at - 5 * 60_000;
    return Date.now() - at < 30 * 60_000; // no record of the checkout: accept a purchase from the last 30 min
  };

  usePolling(
    async () => {
      if (Date.now() > deadline.current) {
        setState("slow");
        return false;
      }
      const [b, me] = await Promise.all([api.billing(), api.me()]);
      onBilling(b);
      setUser(me.user);
      const found = b.transactions.find(isNew);
      if (found) {
        setAmount(found.amountCents);
        setState("done");
        storage.set(CHECKOUT_KEY, null);

        toast(`${eur(found.amountCents)} added to your balance`, { icon: "check" });
        return false;
      }
      return true;
    },
    2000,
    { enabled: state === "waiting" }
  );

  if (!state) return null;

  if (state === "cancelled")
    return (
      <div className="notice" role="status" style={{ marginBottom: 18, background: "var(--surface2)", color: "var(--ink)", boxShadow: "inset 0 0 0 1px var(--line)", alignItems: "center" }}>
        <Icon name="info" />
        <span className="sp">Checkout cancelled — no payment was taken. You can add funds again whenever you&apos;re ready.</span>
        <button type="button" className="btn sm ghost" onClick={() => setState(null)} aria-label="Dismiss">
          <Icon name="x" />
        </button>
      </div>
    );

  if (state === "done")
    return (
      <div className="notice" role="status" style={{ marginBottom: 18, background: "var(--ok-soft)", color: "var(--ok)", alignItems: "center" }}>
        <Icon name="check" />
        <span className="sp">
          <b>Payment complete.</b> {amount !== null ? `${eur(amount)} ` : "Your payment"} landed in your balance. Thank you!
        </span>
        <button type="button" className="btn sm ghost" onClick={() => setState(null)} aria-label="Dismiss">
          <Icon name="x" />
        </button>
      </div>
    );

  if (state === "slow")
    return (
      <div className="notice" role="status" style={{ marginBottom: 18, alignItems: "center" }}>
        <Icon name="clock" />
        <span className="sp">
          <b>Thanks — Stripe confirmed your checkout.</b> The funds are taking a little longer than usual to arrive; this can take a minute or
          two. Nothing is charged twice if you check again.
        </span>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            deadline.current = Date.now() + WAIT_MS;
            setState("waiting");
          }}
        >
          <Icon name="redo" />
          Check again
        </button>
      </div>
    );

  return (
    <div className="notice" role="status" style={{ marginBottom: 18, background: "var(--ok-soft)", color: "var(--ok)", alignItems: "center" }}>
      <span className="spin" aria-hidden="true" style={{ width: 16, height: 16, borderTopColor: "var(--ok)" }} />
      <span className="sp">
        <b>Thanks — Stripe confirmed your checkout.</b> Adding the funds to your balance… this usually takes a few seconds.
      </span>
    </div>
  );
}
