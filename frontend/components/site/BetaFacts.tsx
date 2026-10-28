"use client";

import { useConfig } from "@/lib/config";
import { credits } from "@/lib/format";

/**
 * Commercial facts that depend on how this deployment is configured (GET /api/config): starting balance,
 * whether payments exist, top-up allowance, daily limit, credit packs. Until the config arrives (and for
 * crawlers without JavaScript) the wording stays true without the numbers.
 */
export function BetaFacts({ variant = "list" }: { variant?: "list" | "inline" }) {
  const { config, loaded } = useConfig();
  const starting = loaded && config.startingCreditsCents > 0 ? credits(config.startingCreditsCents) : null;
  const items: string[] = [];
  items.push(starting ? `Every new account starts with ${starting}.` : "Every new account starts with a free credit balance.");
  if (!loaded || !config.paymentsEnabled) items.push("Payments are switched off during the beta: there is nothing to pay and no card to enter.");
  if (loaded && config.topupEnabled && config.topupMaxCents > 0) items.push(`Running low? Add up to ${credits(config.topupMaxCents)} more from Usage, free.`);
  if (loaded && config.maxTasksPerUserPerDay > 0) items.push(`Up to ${config.maxTasksPerUserPerDay} executions a day per account (a fair-use limit during the beta).`);
  if (variant === "inline") return <p className="st-beta-inline">{items.slice(0, 2).join(" ")}</p>;
  return (
    <>
      <ul className="st-beta" aria-live="polite">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {loaded && config.paymentsEnabled && config.creditPacks.length > 0 && (
        <div className="st-packs">
          <p className="st-lg-k">Credit packs</p>
          <ul>
            {config.creditPacks.map((p) => (
              <li key={p.id}>
                <b>{credits(p.credits)}</b>
                <span>{new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(p.priceCents / 100)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
