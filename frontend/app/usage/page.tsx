"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Billing, type Transaction } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { toastApiError } from "@/lib/errors";
import { dateTime, eur, eurSigned, num, plural } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { EmptyState, Icon, PageHead, PageSkeleton, RequireAuth, Tag, useToast } from "@/components";
import { AddFunds } from "./_components/BuyCredits";
import { CheckoutBanner } from "./_components/CheckoutBanner";

export default function UsagePage() {
  return (
    <RequireAuth>
      <Usage />
    </RequireAuth>
  );
}

// "Execution" and "Refund" are asserted by the end-to-end tests.
const TYPE_LABEL: Record<Transaction["type"], string> = { TASK_CHARGE: "Execution", REFUND: "Refund", TOP_UP: "Demo funds", PURCHASE: "Payment" };
const TYPE_TONE: Record<Transaction["type"], "gray" | "ok" | "accent"> = { TASK_CHARGE: "gray", REFUND: "ok", TOP_UP: "accent", PURCHASE: "accent" };

/** Ledger descriptions are stored by the server; show them without repeating the type or legacy wording. */
function describe(t: Transaction): string {
  const d = t.description.trim();
  let m = /^Execution:\s*(.+)$/i.exec(d);
  if (m && t.type === "TASK_CHARGE") return m[1];
  m = /^Refund:\s*(.+)$/i.exec(d);
  if (m && t.type === "REFUND") return m[1];
  m = /^Demo credit top-up\s*\((.+)\)$/i.exec(d);
  if (m) return `Demo funds added (${m[1]})`;
  m = /^Purchased .* credit pack\s*\((.+)\)$/i.exec(d);
  if (m) return `Card payment (${m[1]})`;
  return d;
}

function Usage() {
  const { user, setUser } = useAuth();
  const { config } = useConfig();
  const toast = useToast();
  const [b, setB] = useState<Billing | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback(async () => {
    setFailed(null);
    try {
      setB(await api.billing());
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!b && failed)
    return (
      <div className="wrap op-page">
        <PageHead eyebrow="Usage" title="Usage & spending" />
        <EmptyState icon="alert" title="Usage couldn't be loaded" action={{ label: "Try again", onClick: () => void load() }}>
          {failed}
        </EmptyState>
      </div>
    );
  if (!b || !user) return <PageSkeleton cards={3} />;
  const owner = b.walletOwner === "self";
  const canPay = owner && !user.isGuest && config.paymentsEnabled && config.creditPacks.length > 0;
  const canDemo = owner && !user.isGuest && !config.paymentsEnabled && config.topupEnabled;

  const loadMore = async () => {
    if (!b.nextCursor) return;
    setMore(true);
    try {
      const r = await api.moreTransactions(b.nextCursor);
      setB({ ...b, transactions: [...b.transactions, ...r.transactions], nextCursor: r.nextCursor });
    } catch (e) {
      toastApiError(toast, e, "Couldn't load older transactions");
    } finally {
      setMore(false);
    }
  };

  const topUp = async (cents: number) => {
    try {
      const r = await api.topUp(cents);
      setB(r.billing);
      setUser(r.user);
      toast(`${eur(cents)} of demo funds added`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const objectives = b.usage.byObjective;
  const objectiveTotal = objectives.reduce((n, o) => n + o.spendCents, 0);

  return (
    <div className="wrap op-page">
      <PageHead
        eyebrow="Usage"
        title="Usage & spending"
        sub="Every execution shows its estimated cost before you approve it. It is charged when it starts and refunded automatically for work that fails or never starts."
      />
      <CheckoutBanner onBilling={setB} />

      <div className="op-glance" aria-label="Balance and spending">
        <div className="op-kpi is-accent">
          <span className="op-kpi-l">
            <Icon name="wallet" />
            {owner ? "Balance" : "Organization balance"}
          </span>
          <b className="op-kpi-v" data-testid="balance">
            {eur(b.balanceCents, { decimals: true })}
          </b>
          <span className="op-kpi-m">{owner ? "Available for executions" : "Managed by your organization owner"}</span>
          {(canPay || canDemo) && (
            <span className="op-kpi-a">
              <a href="#funds" className="op-link">
                Add funds <Icon name="arrow" />
              </a>
            </span>
          )}
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">Spend this month</span>
          <span className="op-kpi-v">{eur(b.usage.monthExecutionSpendCents, { decimals: true })}</span>
          <span className="op-kpi-m">on executions, net of refunds</span>
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">Executions this month</span>
          <span className="op-kpi-v">{num(b.usage.monthExecutions)}</span>
          <span className="op-kpi-m">{b.usage.monthExecutions ? `${eur(b.usage.avgExecutionCostCents, { decimals: true })} on average` : "None started yet"}</span>
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">Total spend</span>
          <span className="op-kpi-v">{eur(b.lifetimeSpendCents, { decimals: true })}</span>
          <span className="op-kpi-m">all time, including earlier reports</span>
        </div>
      </div>

      <section className="op-sec" aria-labelledby="h-spend">
        <div className="op-sec-head">
          <div>
            <h2 id="h-spend">
              Spend by objective <span className="op-count">{num(objectives.length)}</span>
            </h2>
            <p className="op-sec-sub">This month, net of refunds. Select an objective to see its plan, evidence and outcome.</p>
          </div>
        </div>
        {objectives.length ? (
          <ul className="op-panel op-spend">
            {objectives.map((o) => {
              const share = objectiveTotal ? Math.round((o.spendCents / objectiveTotal) * 100) : 0;
              return (
                <li key={o.objectiveId}>
                  <div style={{ minWidth: 0 }}>
                    <Link href={ROUTES.objective(o.objectiveId)} className="t" title={o.title}>
                      {o.title}
                    </Link>
                    <span className="op-meta">
                      {plural(o.executions, "execution")} · {share}% of this month&apos;s spend
                    </span>
                  </div>
                  <span className="op-amt">{eur(o.spendCents, { decimals: true })}</span>
                  <span className="op-bar" role="presentation">
                    <i style={{ width: `${share}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="op-panel op-quiet">
            <Icon name="chart" />
            No execution spend this month.
          </div>
        )}
      </section>

      {(canPay || canDemo) && (
        <section id="funds" className="op-sec" aria-labelledby="h-funds">
          <div className="op-sec-head">
            <div>
              <h2 id="h-funds">Add funds</h2>
              <p className="op-sec-sub">Your balance pays for executions: charged when one starts, refunded for work that fails or never starts.</p>
            </div>
          </div>
          {canPay ? (
            <AddFunds packs={config.creditPacks} transactions={b.transactions} orgName={user.team?.name ?? null} />
          ) : (
            <div className="op-panel op-pad">
              <p className="small">Card payments aren&apos;t set up on this server. You can add demo funds (no real money) up to {eur(config.topupMaxCents)} in total.</p>
              <div className="op-inline" style={{ marginTop: 12 }}>
                {[1000, 2000].map((c) => (
                  <button key={c} type="button" className="btn sm" onClick={() => topUp(c)}>
                    <Icon name="plus" />
                    Add {eur(c)} demo funds
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="op-sec" aria-labelledby="h-tx">
        <div className="op-sec-head">
          <div>
            <h2 id="h-tx">Transactions</h2>
            <p className="op-sec-sub">Every charge, refund and payment on this balance, newest first.</p>
          </div>
        </div>
        {b.transactions.length ? (
          <div className="tw op-tx">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Description</th>
                  <th scope="col">By</th>
                  <th scope="col" className="op-tx-amt">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="op-tx-date">{dateTime(t.createdAt)}</td>
                    <td className="op-tx-type">
                      <Tag variant={TYPE_TONE[t.type]}>{TYPE_LABEL[t.type]}</Tag>
                    </td>
                    <td className="op-tx-desc">{describe(t)}</td>
                    <td className="op-tx-by">{t.actor?.name ?? "Ensemblis"}</td>
                    <td className={t.amountCents > 0 ? "op-tx-amt is-in" : "op-tx-amt"}>{eurSigned(t.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="wallet" title="No transactions yet">
            Charges, refunds and payments will be listed here.
          </EmptyState>
        )}
        {b.nextCursor && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button type="button" className="btn sm" onClick={loadMore} aria-busy={more} disabled={more}>
              <Icon name="down" /> Older transactions
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
