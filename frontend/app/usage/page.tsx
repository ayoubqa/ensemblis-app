"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Billing, type Transaction } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { dateTime, eur, eurSigned } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { EmptyState, Icon, PageHead, PageSkeleton, RequireAuth, Tag, useToast } from "@/components";
import { Section } from "@/components/ops";
import { BuyCredits } from "./_components/BuyCredits";
import { CheckoutBanner } from "./_components/CheckoutBanner";

export default function UsagePage() {
  return (
    <RequireAuth>
      <Usage />
    </RequireAuth>
  );
}

const TYPE_LABEL: Record<Transaction["type"], string> = { TASK_CHARGE: "Execution", REFUND: "Refund", TOP_UP: "Demo funds", PURCHASE: "Payment" };

function Usage() {
  const { user, setUser } = useAuth();
  const { config } = useConfig();
  const toast = useToast();
  const [b, setB] = useState<Billing | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback(async () => setB(await api.billing()), []);
  useEffect(() => {
    load().catch((e) => toast.error((e as Error).message));
  }, [load, toast]);

  if (!b || !user) return <PageSkeleton cards={3} />;
  const owner = b.walletOwner === "self";

  const loadMore = async () => {
    if (!b.nextCursor) return;
    setMore(true);
    try {
      const r = await api.moreTransactions(b.nextCursor);
      setB({ ...b, transactions: [...b.transactions, ...r.transactions], nextCursor: r.nextCursor });
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

  return (
    <div className="wrap" style={{ maxWidth: 1080, paddingBottom: 48 }}>
      <PageHead
        eyebrow="USAGE"
        title="Usage & spending"
        sub="Every execution shows its estimated cost before you approve it. It is charged when it starts and refunded automatically for work that fails or never runs."
      />
      <CheckoutBanner onBilling={setB} />
      <div className="kpis">
        <div className="kpi">
          <b data-testid="balance">{eur(b.balanceCents, { decimals: true })}</b>
          <span>{owner ? "Balance" : "Organization balance"}</span>
          <em>{owner ? "Available for executions" : "Managed by your organization owner"}</em>
        </div>
        <div className="kpi">
          <b>{eur(b.usage.monthExecutionSpendCents, { decimals: true })}</b>
          <span>Execution spend this month</span>
          <em>net of refunds</em>
        </div>
        <div className="kpi">
          <b>{b.usage.monthExecutions}</b>
          <span>Executions this month</span>
          <em>avg {eur(b.usage.avgExecutionCostCents, { decimals: true })} each</em>
        </div>
        <div className="kpi">
          <b>{eur(b.lifetimeSpendCents, { decimals: true })}</b>
          <span>Total spend</span>
          <em>incl. earlier reports</em>
        </div>
      </div>

      <Section title="Spend by objective — this month" count={b.usage.byObjective.length}>
        {b.usage.byObjective.length ? (
          <div className="olist">
            {b.usage.byObjective.map((o) => (
              <Link key={o.objectiveId} href={ROUTES.objective(o.objectiveId)} className="orow" style={{ gridTemplateColumns: "minmax(0,1fr) 120px 110px" }}>
                <div className="t">{o.title}</div>
                <span className="small muted">
                  {o.executions} execution{o.executions === 1 ? "" : "s"}
                </span>
                <b style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{eur(o.spendCents, { decimals: true })}</b>
              </Link>
            ))}
          </div>
        ) : (
          <p className="small muted">No execution spend this month.</p>
        )}
      </Section>

      {owner && !user.isGuest && config.paymentsEnabled && (
        <Section title="Add funds">
          <BuyCredits packs={config.creditPacks} transactions={b.transactions} teamName={user.team?.name ?? null} />
        </Section>
      )}
      {owner && !user.isGuest && !config.paymentsEnabled && config.topupEnabled && (
        <Section title="Demo funds">
          <div className="card tight">
            <p className="small">Card payments aren&apos;t set up on this server. You can add demo funds (no real money) up to {eur(config.topupMaxCents)} in total.</p>
            <div className="row wrapflex" style={{ marginTop: 10 }}>
              {[1000, 2000].map((c) => (
                <button key={c} type="button" className="btn sm" onClick={() => topUp(c)}>
                  Add {eur(c)} demo funds
                </button>
              ))}
            </div>
          </div>
        </Section>
      )}

      <Section title="Transactions">
        {b.transactions.length ? (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>By</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {b.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="small">{dateTime(t.createdAt)}</td>
                    <td>
                      <Tag variant={t.type === "REFUND" ? "ok" : t.type === "TASK_CHARGE" ? "gray" : "accent"}>{TYPE_LABEL[t.type]}</Tag>
                    </td>
                    <td className="small" style={{ whiteSpace: "normal" }}>
                      {t.description}
                    </td>
                    <td className="small muted">{t.actor?.name ?? "Ensemblis"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: t.amountCents > 0 ? "var(--ok)" : undefined }}>{eurSigned(t.amountCents)}</td>
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
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={loadMore} aria-busy={more} disabled={more}>
              <Icon name="down" /> Older transactions
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}
