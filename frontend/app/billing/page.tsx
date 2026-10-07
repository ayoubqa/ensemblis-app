"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChipGroup, EmptyState, HBar, Icon, LineChart, RequireAuth, Skeleton, SkeletonText, Tag, useToast, type TagVariant } from "@/components";
import { api, type Billing, type Task, type TeamDetail, type Transaction, type User } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { dateTime, dayLabel, eur, eurSigned, plural } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { downloadCsv, spendBy, spendSeries, startOfMonth } from "../dashboard/_lib/insights";
import { BuyCredits } from "./_components/BuyCredits";
import { CheckoutBanner } from "./_components/CheckoutBanner";

export default function BillingPage() {
  return (
    <RequireAuth>
      <BillingGate />
    </RequireAuth>
  );
}

const CLAIM_HREF = `${ROUTES.signup}?claim=1`;

const TYPE_META: Record<Transaction["type"], { label: string; variant: TagVariant }> = {
  TASK_CHARGE: { label: "Charge", variant: "accent" },
  REFUND: { label: "Refund", variant: "gray" },
  TOP_UP: { label: "Demo top-up", variant: "ok" },
  PURCHASE: { label: "Purchase", variant: "ok" },
};
const FILTER_TYPE: Record<string, Transaction["type"] | null> = {
  All: null,
  Charges: "TASK_CHARGE",
  Refunds: "REFUND",
  Purchases: "PURCHASE",
  "Top-ups": "TOP_UP",
};
const PRESETS = [1000, 2500, 5000, 10000];
const MAX_TOPUP = 50000;

function BillingGate() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.isGuest) return <GuestBilling credits={user.credits} />;
  return <BillingView />;
}

/** Guests can't buy or top up — invite them to keep their work with a free account. */
function GuestBilling({ credits }: { credits: number }) {
  return (
    <div className="narrow" style={{ padding: "40px 24px 56px" }}>
      <div className="card" style={{ padding: "clamp(22px,4vw,36px)" }}>
        <span className="tag warn">
          <Icon name="user" />
          Guest session
        </span>
        <h1 className="serif" style={{ fontSize: "clamp(26px,3.6vw,36px)", lineHeight: 1.1, margin: "12px 0 8px" }}>
          You have {eur(credits)} in trial credits.
        </h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Create a free account to keep your tasks and results, see your full payment history, and add credits when you need more. Everything
          you&apos;ve done as a guest comes with you.
        </p>
        <div className="row wrapflex" style={{ marginTop: 18 }}>
          <Link className="btn p" href={CLAIM_HREF}>
            <Icon name="check" />
            Create a free account
          </Link>
          <Link className="btn" href={ROUTES.tasks}>
            Back to my work
          </Link>
        </div>
      </div>
    </div>
  );
}

function BillingView() {
  const { user, setUser } = useAuth();
  const { config, loaded } = useConfig();
  const toast = useToast();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [breakdown, setBreakdown] = useState<"Category" | "Agent">("Category");
  const [showAll, setShowAll] = useState(false);

  const inTeam = !!user?.team;
  const isMember = user?.team?.role === "MEMBER";
  const teamWallet = user?.walletOwner === "team";

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, t] = await Promise.all([api.billing(), api.listTasks().catch(() => ({ tasks: [] as Task[] }))]);
      setBilling(b);
      setTasks(t.tasks);
    } catch (e) {
      setError(errorText(e, "Couldn't load your payments."));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Team details (owner name for members, team name for the wallet hint).
  useEffect(() => {
    if (!inTeam) {
      setTeam(null);
      return;
    }
    let live = true;
    api.getTeam().then(
      (r) => live && setTeam(r.team),
      () => {}
    );
    return () => {
      live = false;
    };
  }, [inTeam, user?.team?.id]);

  const txs = useMemo(() => billing?.transactions ?? [], [billing]);
  const taskById = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const monthTasks = useMemo(() => (tasks ?? []).filter((t) => new Date(t.createdAt) >= startOfMonth() && t.status !== "REFUNDED" && t.status !== "FAILED").length, [tasks]);
  const series = useMemo(() => (billing ? spendSeries(billing.transactions, "day", 30) : null), [billing]);
  const groups = useMemo(() => (tasks ? spendBy(tasks, breakdown === "Category" ? (t) => t.category : (t) => t.agent?.name) : []), [tasks, breakdown]);
  const refundedCents = useMemo(() => txs.filter((t) => t.type === "REFUND").reduce((s, t) => s + t.amountCents, 0), [txs]);
  const toppedUpCents = useMemo(() => txs.filter((t) => t.type === "TOP_UP").reduce((s, t) => s + t.amountCents, 0), [txs]);
  const purchasedCents = useMemo(() => txs.filter((t) => t.type === "PURCHASE").reduce((s, t) => s + t.amountCents, 0), [txs]);
  const hasPurchases = txs.some((t) => t.type === "PURCHASE");
  // Show "who" when the wallet is shared or anyone other than you moved credits.
  const showActor = teamWallet || inTeam || txs.some((t) => t.actor && t.actor.id !== user?.id);

  const filters = useMemo(
    () => ["All", "Charges", "Refunds", ...(config.paymentsEnabled || hasPurchases ? ["Purchases"] : []), "Top-ups"],
    [config.paymentsEnabled, hasPurchases]
  );
  const rows = useMemo(() => {
    const ft = FILTER_TYPE[filter];
    return txs.filter((t) => !ft || t.type === ft);
  }, [txs, filter]);
  const visible = showAll ? rows : rows.slice(0, 25);

  const actorName = (t: Transaction) => (t.actor ? (t.actor.id === user?.id ? "You" : t.actor.name) : null);

  const exportCsv = () => {
    if (!billing) return;
    const data = [
      ["Date", "Type", "Description", "Task", ...(showActor ? ["By"] : []), "Amount (EUR)", "Task ID"],
      ...billing.transactions.map((t) => [
        new Date(t.createdAt).toISOString(),
        TYPE_META[t.type]?.label ?? t.type,
        t.description,
        t.taskId ? taskById.get(t.taskId)?.title ?? "" : "",
        ...(showActor ? [t.actor?.name ?? ""] : []),
        (t.amountCents / 100).toFixed(2),
        t.taskId ?? "",
      ]),
    ];
    const ok = downloadCsv(`ensemblis-transactions-${new Date().toISOString().slice(0, 10)}.csv`, data);
    if (ok) toast("CSV downloaded", { icon: "dl" });
    else toast.error("Your browser blocked the download.");
  };

  if (!user) return null;

  const payments = loaded && config.paymentsEnabled;
  const creditWord = payments ? "credits" : "demo credits";
  const teamName = team?.name ?? user.team?.name ?? null;
  const ownerName = team?.owner.name ?? null;

  return (
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <div className="pagehead row between wrapflex" style={{ alignItems: "flex-end" }}>
        <div>
          <h1>Payments</h1>
          <p>
            You only pay for completed work — failed tasks are refunded automatically.{" "}
            {payments
              ? "Buy credit packs securely through Stripe; 1 credit = €0.01 of agent work."
              : "This is a demo account: balances are demo credits and nothing is ever charged to a card."}
          </p>
        </div>
        <span className="credpill" title={teamWallet ? `Team wallet — ${teamName ?? "your team"}` : undefined}>
          <Icon name="eur" />
          {eur(user.credits)} {creditWord}
          {teamWallet && <span className="tiny" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>· team</span>}
        </span>
      </div>

      <Suspense fallback={null}>
        <CheckoutBanner onBilling={setBilling} />
      </Suspense>

      {isMember && (
        <div className="notice" role="status" style={{ marginBottom: 18, background: "var(--accent-soft)", color: "var(--accent)", alignItems: "center" }}>
          <Icon name="share" />
          <span className="sp">
            <b>Credits are managed by your team owner{ownerName ? ` (${ownerName})` : ""}.</b> Your tasks are paid from the {teamName ?? "team"} wallet
            — ask them to add credits when it runs low.
          </span>
          <Link className="btn sm" href={ROUTES.team}>
            View team
          </Link>
        </div>
      )}

      {error && (
        <div className="notice" role="alert" style={{ marginBottom: 18 }}>
          <Icon name="alert" />
          <div className="sp">{error}</div>
          <button type="button" className="btn sm" onClick={load}>
            Try again
          </button>
        </div>
      )}

      <div className="grid g3" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="eyebrow">THIS MONTH</div>
          {billing ? (
            <>
              <b style={{ fontSize: 34 }}>{eur(billing.monthSpendCents)}</b>
              <div className="small muted" style={{ marginBottom: 8 }}>
                Across {plural(monthTasks, "task")} · last 30 days below
              </div>
              {series && <LineChart values={series.values.map((v) => v / 100)} xLabels={series.labels} height={100} label="Daily spending, last 30 days" format={(v) => eur(Math.round(v * 100))} />}
            </>
          ) : (
            <>
              <Skeleton width="45%" height={32} />
              <Skeleton height={90} style={{ marginTop: 14 }} />
            </>
          )}
        </div>

        <WalletCard
          user={user}
          isMember={isMember}
          teamWallet={teamWallet}
          teamName={teamName}
          ownerName={ownerName}
          payments={payments}
          toppedUpCents={billing ? toppedUpCents : null}
          onDone={setBilling}
          onUser={setUser}
        />

        <div className="card">
          <div className="eyebrow">PLAN</div>
          <b>Pay as you go</b>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            Pay per task. No subscription{inTeam ? "; your team shares one wallet." : ", no seats to manage."}
          </p>
          {billing ? (
            <>
              <div className="kv">
                <span className="muted">Lifetime spend</span>
                <b>{eur(billing.lifetimeSpendCents)}</b>
              </div>
              <div className="kv">
                <span className="muted">Refunded</span>
                <b>{eur(refundedCents)}</b>
              </div>
              {(payments || purchasedCents > 0) && (
                <div className="kv">
                  <span className="muted">Bought with Stripe</span>
                  <b>{eur(purchasedCents)}</b>
                </div>
              )}
              <div className="kv" style={{ borderBottom: 0 }}>
                <span className="muted">Demo credits added</span>
                <b>{eur(toppedUpCents)}</b>
              </div>
            </>
          ) : (
            <SkeletonText lines={3} />
          )}
          <Link href={ROUTES.pricing} className="tiny" style={{ color: "var(--accent)", fontWeight: 600, display: "inline-block", marginTop: 8 }}>
            Compare plans →
          </Link>
        </div>
      </div>

      {payments && !isMember && <BuyCredits packs={config.creditPacks ?? []} transactions={billing?.transactions ?? null} teamName={user.team ? teamName : null} />}

      {/* Breakdown */}
      <section className="card" style={{ marginTop: 16 }} aria-labelledby="h-break">
        <div className="row between wrapflex">
          <h3 id="h-break" style={{ margin: 0 }}>
            Where your credits go
          </h3>
          <ChipGroup options={["Category", "Agent"]} value={breakdown} onChange={(v) => setBreakdown(v as "Category" | "Agent")} label="Break down by" />
        </div>
        {tasks === null ? (
          <div style={{ marginTop: 14 }}>
            <SkeletonText lines={4} />
          </div>
        ) : groups.length ? (
          <div className="stack" style={{ gap: 10, marginTop: 14 }}>
            {groups.slice(0, 6).map((g) => (
              <HBar key={g.label} label={g.label} value={g.cents} max={groups[0].cents || 1} display={`${eur(g.cents)} · ${plural(g.count, "task")}`} labelWidth={170} />
            ))}
            <p className="tiny muted">Billed tasks only — refunded and failed tasks are excluded.</p>
          </div>
        ) : (
          <p className="small muted" style={{ marginTop: 10 }}>
            Once you run tasks, you&apos;ll see spend broken down by {breakdown === "Category" ? "kind of work" : "agent"} here.
          </p>
        )}
      </section>

      {/* Transactions */}
      <div className="row between wrapflex" style={{ margin: "26px 0 10px", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Transaction history{teamWallet && teamName ? ` · ${teamName} wallet` : ""}</h3>
        <div className="row wrapflex" style={{ gap: 8 }}>
          <ChipGroup
            options={filters}
            value={filters.includes(filter) ? filter : "All"}
            onChange={(v) => {
              setFilter(v);
              setShowAll(false);
            }}
            label="Filter transactions"
          />
          <button type="button" className="btn sm" onClick={exportCsv} disabled={!billing?.transactions.length}>
            <Icon name="dl" />
            Export CSV
          </button>
        </div>
      </div>
      {billing === null && !error ? (
        <div className="card">
          <SkeletonText lines={6} />
        </div>
      ) : billing && billing.transactions.length === 0 ? (
        <EmptyState icon="wallet" title="No transactions yet" action={{ label: "Start a task", href: ROUTES.newTask, icon: "plus" }}>
          Charges, refunds{payments ? ", purchases" : ""} and demo top-ups will show up here as they happen.
        </EmptyState>
      ) : billing ? (
        <div className="tw">
          <table style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Type</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th aria-label="Linked task" />
              </tr>
            </thead>
            <tbody>
              {visible.length ? (
                visible.map((t) => {
                  const task = t.taskId ? taskById.get(t.taskId) : undefined;
                  const meta = TYPE_META[t.type] ?? { label: t.type, variant: "gray" as TagVariant };
                  const who = showActor ? actorName(t) : null;
                  return (
                    <tr key={t.id}>
                      <td title={dateTime(t.createdAt)}>{dayLabel(t.createdAt)}</td>
                      <td style={{ whiteSpace: "normal", minWidth: 220 }}>
                        <div>{task?.title ?? t.description}</div>
                        {task && task.title !== t.description && <div className="tiny muted">{t.description}</div>}
                        {who && <div className="tiny muted">by {who}</div>}
                      </td>
                      <td>
                        <Tag variant={meta.variant} icon={t.type === "PURCHASE" ? "lock" : undefined} title={t.type === "PURCHASE" ? "Paid with Stripe" : t.type === "TOP_UP" ? "Free demo credits — never charged" : undefined}>
                          {meta.label}
                        </Tag>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: t.amountCents > 0 ? "var(--ok)" : "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{eurSigned(t.amountCents)}</td>
                      <td style={{ textAlign: "right" }}>
                        {t.taskId && (
                          <Link className="btn sm" href={ROUTES.task(t.taskId)}>
                            View task
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 30 }}>
                    No {filter.toLowerCase()} yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length > 25 && !showAll && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button type="button" className="btn sm" onClick={() => setShowAll(true)}>
            Show all {rows.length}
          </button>
        </div>
      )}
    </div>
  );
}

/** Balance + whatever this person can do to add credits (demo top-up, buy packs, or ask the team owner). */
function WalletCard({
  user,
  isMember,
  teamWallet,
  teamName,
  ownerName,
  payments,
  toppedUpCents,
  onDone,
  onUser,
}: {
  user: User;
  isMember: boolean;
  teamWallet: boolean;
  teamName: string | null;
  ownerName: string | null;
  payments: boolean;
  /** lifetime sum of TOP_UP transactions; null while billing loads */
  toppedUpCents: number | null;
  onDone: (b: Billing) => void;
  onUser: (u: User) => void;
}) {
  return (
    <div className="card">
      <div className="row between">
        <div className="eyebrow" style={{ margin: 0 }}>
          {teamWallet ? "TEAM WALLET" : "BALANCE"}
        </div>
        {teamWallet && teamName && (
          <span className="tag gray" title={`Team wallet — ${teamName}`} style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}>
            {teamName}
          </span>
        )}
      </div>
      <b style={{ fontSize: 34, display: "block", marginTop: 10 }}>{eur(user.credits)}</b>
      <div className="small muted" style={{ marginBottom: 12 }}>
        {teamWallet ? (isMember ? "Shared team balance you spend from" : "Shared with your team — members' tasks draw from it") : "Available balance"}
      </div>
      {isMember ? (
        <div className="notice" role="status" style={{ background: "var(--surface2)", color: "var(--muted)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
          <Icon name="lock" />
          <div className="sp">Credits are managed by your team owner{ownerName ? ` (${ownerName})` : ""}. Only they can add credits.</div>
        </div>
      ) : (
        <DemoTopUp toppedUpCents={toppedUpCents} payments={payments} onDone={onDone} onUser={onUser} />
      )}
    </div>
  );
}

function DemoTopUp({
  toppedUpCents,
  payments,
  onDone,
  onUser,
}: {
  toppedUpCents: number | null;
  payments: boolean;
  onDone: (b: Billing) => void;
  onUser: (u: User) => void;
}) {
  const toast = useToast();
  const { config, loaded } = useConfig();
  // Lifetime demo top-up allowance (server-enforced; mirrored here for a clear UI).
  const capKnown = loaded && toppedUpCents !== null;
  const disabledByServer = loaded && (!config.topupEnabled || config.topupMaxCents <= 0);
  const remaining = capKnown ? Math.max(0, config.topupMaxCents - (toppedUpCents ?? 0)) : null;
  const exhausted = !disabledByServer && remaining !== null && remaining < 100;
  const maxPer = remaining !== null ? Math.min(MAX_TOPUP, remaining) : MAX_TOPUP;
  const presets = PRESETS.filter((p) => p <= maxPer);
  const [amount, setAmount] = useState<number>(2500);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const customCents = custom.trim() ? Math.round(parseFloat(custom.replace(",", ".")) * 100) : null;
  // If the chosen preset is above what's left of the allowance, fall back to the largest one that fits (or the remainder).
  const presetCents = amount <= maxPer ? amount : presets[presets.length - 1] ?? maxPer;
  const cents = customCents ?? presetCents;
  const invalid = customCents !== null && (!Number.isFinite(customCents) || customCents < 100 || customCents > maxPer);
  const presetTooBig = customCents === null && (cents > maxPer || cents < 100);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) {
      setErr(`Enter an amount between €1 and ${eur(maxPer)}.`);
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const r = await api.topUp(cents);
      onUser(r.user);
      onDone(r.billing);
      setCustom("");
      toast(`${eur(cents)} demo credits added`, { icon: "check" });
    } catch (e2) {
      setErr(errorText(e2, "Couldn't add credits"));
    } finally {
      setBusy(false);
    }
  };

  if (disabledByServer || exhausted) {
    if (payments)
      return (
        <a className="btn p sm" href="#buy">
          <Icon name="plus" />
          Buy credits
        </a>
      );
    return (
      <div className="notice" role="status" style={{ marginTop: 4 }}>
        <Icon name="info" />
        <div className="sp">
          {disabledByServer
            ? "Top-ups are turned off on this public demo. Every account gets its starting credits — when they run out, that's the end of the free trial."
            : `You've used this demo's full top-up allowance (${eur(config.topupMaxCents)} per account). Thanks for trying Ensemblis!`}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} aria-labelledby="h-demo-topup" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <b className="small" id="h-demo-topup">
          Add demo credits
        </b>
        <span className="demob">
          <Icon name="spark" />
          Demo · never charged
        </span>
      </div>
      <div className="row wrapflex" style={{ gap: 6 }} role="radiogroup" aria-label="Demo top-up amount">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={customCents === null && presetCents === p}
            className={customCents === null && presetCents === p ? "chip on" : "chip"}
            onClick={() => {
              setAmount(p);
              setCustom("");
              setErr(null);
            }}
          >
            {eur(p)}
          </button>
        ))}
      </div>
      <label className="l" htmlFor="topup-custom" style={{ marginTop: 12 }}>
        Or a custom amount (€)
      </label>
      <input
        id="topup-custom"
        className="f"
        inputMode="decimal"
        placeholder="e.g. 40"
        value={custom}
        onChange={(e) => {
          setCustom(e.target.value.replace(/[^\d.,]/g, ""));
          setErr(null);
        }}
        aria-invalid={invalid || !!err}
        aria-describedby="topup-hint"
      />
      {err ? (
        <div className="err" role="alert">
          {err}
        </div>
      ) : (
        <div className="hint" id="topup-hint">
          Demo credits only — no real payment is taken.{" "}
          {remaining !== null ? <>You can add {eur(remaining)} more on this account.</> : <>Up to {eur(MAX_TOPUP)} per top-up.</>}
        </div>
      )}
      <button type="submit" className={payments ? "btn sm" : "btn sm p"} style={{ marginTop: 12 }} disabled={busy || invalid || presetTooBig} aria-busy={busy}>
        <Icon name="plus" />
        Add {invalid || presetTooBig ? "" : eur(cents)} demo credits
      </button>
      {payments && (
        <a className="tiny" href="#buy" style={{ display: "block", marginTop: 10, color: "var(--accent)", fontWeight: 600 }}>
          Or buy real credits below →
        </a>
      )}
    </form>
  );
}
