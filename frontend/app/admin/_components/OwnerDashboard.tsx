"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Icon, LineChart, Skeleton, SkeletonText, useToast, type IconName } from "@/components";
import { api, ApiError, type AdminEconomics, type AdminOverview, type AdminValidation } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { credits, eur, num, pct, plural, relativeTime, dateTime } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import { compact, dayLabelUTC, sumDays, usageTone } from "./adminFormat";
import { DailyBars } from "./DailyBars";

const REFRESH_MS = 60_000;

/** The operations console (ADMIN_EMAILS only). Reads GET /api/admin/overview — real counts only. */
export function OwnerDashboard() {
  const toast = useToast();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);
  const inflight = useRef(false);

  const load = useCallback(
    async (manual = false) => {
      if (inflight.current) return;
      inflight.current = true;
      if (manual) setRefreshing(true);
      try {
        const d = await api.adminOverview();
        setData(d);
        setError(null);
        if (manual) toast("Console refreshed", { icon: "check" });
      } catch (e) {
        setError(e);
        if (manual) toast.error(errorText(e, "Couldn't refresh the console"));
      } finally {
        inflight.current = false;
        setRefreshing(false);
      }
    },
    [toast]
  );

  // Initial load + auto-refresh every minute (pauses while the tab is hidden).
  usePolling(() => load(), REFRESH_MS);
  // Keep "updated 2m ago" honest between refreshes.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const forbidden = error instanceof ApiError && (error.status === 403 || error.status === 401);

  return (
    <div className="wrap op-page">
      <div className="pagehead sh-ph">
        <div className="sh-ph-main">
          <div className="eyebrow">Operations console</div>
          <div className="sh-ph-tag">
            <span className="tag ok">
              <span className="op-live" style={{ color: "var(--ok)" }}>
                Live data
              </span>
            </span>
          </div>
          <h1>How this deployment is performing</h1>
          <p className="sh-ph-desc">
            {data ? (
              <>
                Updated <span title={dateTime(data.generatedAt)}>{relativeTime(data.generatedAt)}</span> · refreshes every minute. Days are counted in UTC.
              </>
            ) : (
              "Executions, queue health, verification, AI usage and money for this deployment."
            )}
          </p>
        </div>
        <div className="sh-ph-actions">
          <button type="button" className="btn" onClick={() => load(true)} aria-busy={refreshing} disabled={refreshing}>
            <Icon name="redo" />
            Refresh
          </button>
        </div>
      </div>

      {error != null && (
        <div className="notice" role="alert" style={{ marginBottom: 16, ...(data ? {} : { background: "var(--bad-soft)", color: "var(--bad)" }) }}>
          <Icon name={forbidden ? "lock" : "alert"} />
          <div className="sp">
            {forbidden
              ? "The server didn't recognize this account as an operator. Your email must be listed in ADMIN_EMAILS on the backend and verified."
              : data
                ? `Couldn't refresh (${errorText(error)}). Showing data from ${relativeTime(data.generatedAt)}.`
                : errorText(error, "Couldn't load the console.")}
          </div>
          {!forbidden && (
            <button type="button" className="btn sm" onClick={() => load(true)} disabled={refreshing}>
              Try again
            </button>
          )}
        </div>
      )}

      {!data ? error != null ? null : <DashboardSkeleton /> : <Body d={data} />}
    </div>
  );
}

// ------------------------------------------------------------------ body
function Body({ d }: { d: AdminOverview }) {
  const users = d.users;
  const ex = d.executions;
  const ai = d.ai;
  const search = d.search;
  const q = d.queue;
  const signups14 = sumDays(users.signupsLast14d);
  const tokensToday = (ai.tokensInToday || 0) + (ai.tokensOutToday || 0);
  const settled = ex.completed + ex.failed;
  const successRate = settled ? Math.round((ex.completed / settled) * 1000) / 10 : null;
  const signupDays = users.signupsLast14d ?? [];
  const tokenDays = ai.tokensLast14d ?? [];
  const failures = d.recentFailures ?? [];
  const recentUsers = d.recentUsers ?? [];
  const verified = ex.verification.pass + ex.verification.warnings + ex.verification.failedAccepted;
  const queueStale = q.oldestQueuedSeconds > 120;

  return (
    <>
      {d.security?.inviteCode === "weak" && (
        <div className="notice" role="alert" data-testid="weak-invite" style={{ marginBottom: 16, background: "var(--bad-soft)", color: "var(--bad)" }}>
          The sign-up invite code is short or easy to guess, so anyone who guesses it can create accounts and spend starting credits. Replace
          SIGNUP_INVITE_CODE on the API service with a long random value (for example the output of <code>openssl rand -base64 24</code>) and share sign-up
          links as <code>/signup#invite=…</code>.
        </div>
      )}
      <h2 className="sr-only">Today at a glance</h2>
      <div className="op-tiles">
        <Tile icon="user" label="Users" value={num(users.total)} delta={signups14 ? `+${num(signups14)} in 14 days` : undefined}>
          {num(users.organizations)} organizations · {num(users.guests)} guests
        </Tile>
        <Tile
          icon="zap"
          label="Executions today"
          value={num(ex.runsToday)}
          of={ex.dailyCapGlobal > 0 ? num(ex.dailyCapGlobal) : undefined}
          meter={{ used: ex.runsToday, limit: ex.dailyCapGlobal, label: "Executions today against the global daily cap" }}
        >
          {ex.inFlight > 0 ? (
            <span className="row" style={{ gap: 6, display: "inline-flex" }}>
              <i className="pulse" aria-hidden="true" />
              {num(ex.inFlight)} in flight · {num(ex.waiting)} waiting
            </span>
          ) : (
            `${num(ex.waiting)} waiting on people`
          )}
        </Tile>
        <Tile
          icon="layers"
          label="Execution queue"
          value={num(q.queued)}
          flag={q.deadLast24h > 0 ? { tone: "bad", text: `${num(q.deadLast24h)} dead (24h)` } : queueStale ? { tone: "warn", text: "Backlog" } : undefined}
        >
          {num(q.running)} in progress · oldest queued {q.queued ? `${num(q.oldestQueuedSeconds)}s` : "—"}
        </Tile>
        <Tile
          icon="alert"
          label="Needs people"
          value={num(ex.pendingApprovals + ex.openExceptions)}
        >
          {plural(ex.pendingApprovals, "pending approval")} · {plural(ex.openExceptions, "open exception")}
        </Tile>
        <Tile
          icon="check"
          label="Execution success"
          value={pct(successRate)}
          flag={successRate !== null && successRate < 80 && settled >= 5 ? { tone: "warn", text: "Below 80%" } : undefined}
        >
          {num(ex.completed)} completed · {num(ex.failed)} failed · {num(ex.cancelled)} cancelled
        </Tile>
        <Tile icon="shield" label="Verification" value={verified ? pct(Math.round((ex.verification.pass / verified) * 1000) / 10) : "—"}>
          {num(ex.verification.pass)} pass · {num(ex.verification.warnings)} with warnings · {num(ex.verification.failedAccepted)} failed & accepted
        </Tile>
        <Tile icon="chart" label="AI calls today" value={num(ai.callsToday)} flag={ai.failuresToday > 0 ? { tone: "bad", text: `${num(ai.failuresToday)} failed` } : undefined}>
          {ai.providerLabel || "AI provider"} · {compact(tokensToday)} tokens
          {ai.premium && "model" in ai.premium && <PremiumLine p={ai.premium} />}
        </Tile>
        <Tile
          icon="globe"
          label="Web searches today"
          value={num(search.callsToday)}
          of={search.dailyBudget > 0 ? num(search.dailyBudget) : undefined}
          meter={search.dailyBudget > 0 ? { used: search.callsToday, limit: search.dailyBudget, label: "Searches today against the daily budget" } : undefined}
        >
          {num(search.callsThisMonth)} this month · {search.providerLabel || "Off"}
        </Tile>
        <Tile icon="mail" label="Emails today" value={d.email.enabled ? num(d.email.sentToday) : "—"} flag={d.email.enabled ? undefined : { tone: "gray", text: "Email off" }}>
          {d.email.enabled ? "Notifications, verification and password resets" : "Set up email on the backend to send them"}
        </Tile>
        <Tile icon="eur" label="Purchases" value={eur(d.money.purchasesCents)}>
          {plural(d.money.purchasesCount, "Stripe payment")} · {credits(d.money.demoTopupsCents)} of demo top-ups
        </Tile>
        {d.ledger && (
          <Tile
            icon="shield"
            label="Credit ledger"
            value={d.ledger.mismatches ? num(d.ledger.mismatches) : "OK"}
            flag={d.ledger.mismatches ? { tone: "bad", text: "Mismatch" } : undefined}
          >
            {d.ledger.mismatches
              ? `${plural(d.ledger.mismatches, "balance")} differ from the ledger — see the backend log (ledger.mismatch)`
              : `${plural(d.ledger.walletsChecked, "balance")} match the ledger`}
          </Tile>
        )}
        <Tile icon="file" label="Earlier reports" value={num(ex.legacyTasks)}>
          Read-only reports from before objectives
        </Tile>
        <Tile icon="flag" label="All executions" value={num(ex.total)}>
          since this deployment started
        </Tile>
      </div>

      <h2 className="sr-only">Last 14 days</h2>
      <div className="op-charts">
        <div className="op-panel op-chart">
          <div className="op-chart-h">
            <h3>Sign-ups</h3>
            <span className="op-meta">{num(signups14)} in 14 days</span>
          </div>
          <div>
            <LineChart
              values={signupDays.map((x) => x.count)}
              xLabels={signupDays.map((x) => dayLabelUTC(x.day))}
              height={140}
              label={`New accounts per day, last 14 days: ${num(signups14)} in total`}
              format={(v) => `${num(v)} sign-up${v === 1 ? "" : "s"}`}
            />
          </div>
        </div>
        <div className="op-panel op-chart">
          <div className="op-chart-h">
            <h3>Executions</h3>
            <span className="op-meta">last 14 days</span>
          </div>
          <div>
            <DailyBars completed={ex.completedLast14d ?? []} failed={ex.failedLast14d ?? []} height={140} label="Completed and failed executions per day, last 14 days" />
          </div>
        </div>
        <div className="op-panel op-chart">
          <div className="op-chart-h">
            <h3>AI tokens</h3>
            <span className="op-meta">{compact(sumDays(tokenDays))} in 14 days</span>
          </div>
          <div>
            <LineChart
              values={tokenDays.map((x) => x.count)}
              xLabels={tokenDays.map((x) => dayLabelUTC(x.day))}
              height={140}
              label="AI tokens (input plus output) per day, last 14 days"
              format={(v) => `${compact(v)} tokens`}
            />
          </div>
        </div>
      </div>

      <Economics />
      <Validation />

      <h2 className="sr-only">Recent activity</h2>
      <div className="op-lanes">
        <section className="op-panel" aria-labelledby="h-failures" style={{ minWidth: 0 }}>
          <div className="op-chart-h" style={{ padding: "16px 18px 4px", margin: 0 }}>
            <h3 id="h-failures">Recent failed executions</h3>
            {failures.length > 0 && <span className="tag bad">{num(failures.length)}</span>}
          </div>
          {failures.length === 0 ? (
            <p className="op-quiet" style={{ paddingTop: 10 }}>
              <Icon name="check" style={{ color: "var(--ok)" }} />
              No failed executions recently.
            </p>
          ) : (
            <ul className="op-list" style={{ marginTop: 4 }}>
              {failures.slice(0, 8).map((f) => (
                <li key={f.executionId} className="op-lane">
                  <span style={{ color: "var(--bad)", flex: "none", marginTop: 2 }}>
                    <Icon name="alert" label="Failed" />
                  </span>
                  <div className="op-lane-b">
                    <b>{f.title}</b>
                    <div className="op-meta op-clamp2" title={f.error}>
                      {f.error || "No error message recorded"}
                    </div>
                  </div>
                  <span className="op-meta op-lane-t" title={dateTime(f.at)}>
                    {relativeTime(f.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="op-panel" aria-labelledby="h-users" style={{ minWidth: 0 }}>
          <div className="op-chart-h" style={{ padding: "16px 18px 4px", margin: 0 }}>
            <h3 id="h-users">Recent users</h3>
            <span className="op-meta">newest first</span>
          </div>
          {recentUsers.length === 0 ? (
            <p className="op-quiet" style={{ paddingTop: 10 }}>
              No users yet.
            </p>
          ) : (
            <ul className="op-list" style={{ marginTop: 4 }}>
              {recentUsers.slice(0, 10).map((u) => (
                <li key={u.id} className="op-lane" style={{ alignItems: "center" }}>
                  <Avatar name={u.isGuest ? "Guest" : u.name} size="xs" round />
                  <div className="op-lane-b">
                    <b>{u.isGuest ? "Guest" : u.name}</b>
                    {!u.isGuest && (
                      <div className="op-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.email}>
                        {u.email}
                      </div>
                    )}
                  </div>
                  {u.isGuest ? <span className="tag warn">Guest</span> : u.verified ? <span className="tag ok">Verified</span> : <span className="tag gray">Unverified</span>}
                  <span className="op-meta op-lane-t" title={dateTime(u.createdAt)}>
                    {relativeTime(u.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="op-note" style={{ marginTop: 22 }}>
        Counts come straight from this deployment&apos;s database. “Today” and the 14-day charts use UTC days. Money: Stripe purchases are real payments;
        demo top-ups are free balance.
      </p>
    </>
  );
}


/** Premium model route status under the AI tile: why it isn't serving calls, or today's spend against its budget. */
function PremiumLine({ p }: { p: Extract<NonNullable<AdminOverview["ai"]["premium"]>, { model: string }> }) {
  const state = !p.configured
    ? "off: PREMIUM_API_KEY not set"
    : !p.priced
      ? "off: no price in PROVIDER_PRICING"
      : p.pausedFor
        ? `paused (${p.pausedFor}), using the fallback`
        : p.dailyBudgetEur != null && p.spentTodayEurMicros != null
          ? `${eurMicros(p.spentTodayEurMicros)} of €${p.dailyBudgetEur} today`
          : "on";
  return (
    <>
      <br />
      {p.model}: {state}
    </>
  );
}

/** Millionths of EUR: "€0.0123" below €1, "€12.34" above. */
function eurMicros(m: number | null): string {
  if (m == null) return "—";
  const e = m / 1_000_000;
  return `€${e.toLocaleString("en-US", { minimumFractionDigits: e < 1 ? 4 : 2, maximumFractionDigits: e < 1 ? 4 : 2 })}`;
}

/** Internal unit economics, last 30 days (GET /api/admin/economics). Loaded apart so the dashboard never waits on it. */
function Economics() {
  const [e, setE] = useState<AdminEconomics | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.adminEconomics(30).then(setE, () => setFailed(true));
  }, []);
  if (failed) return null;
  const vc = e?.variableCost;
  const gaps = vc ? [vc.unpricedEvents && `${num(vc.unpricedEvents)} unpriced`, vc.failedEvents && `${num(vc.failedEvents)} failed (cost unknown)`, vc.unconvertibleEvents && `${num(vc.unconvertibleEvents)} without an exchange rate`].filter(Boolean) : [];
  return (
    <section className="op-panel op-econ" aria-labelledby="h-econ">
      <div className="op-chart-h" style={{ padding: "16px 18px 4px", margin: 0 }}>
        <h3 id="h-econ">Unit economics · last 30 days</h3>
        <span className="op-meta">internal — never shown to customers</span>
      </div>
      {!e ? (
        <div style={{ padding: "8px 18px 18px" }}>
          <SkeletonText lines={2} />
        </div>
      ) : (
        <>
          <dl className="op-econ-grid">
            <div>
              <dt>Completed executions</dt>
              <dd>
                {num(e.executions.completed)} <small>of {num(e.executions.total)}</small>
              </dd>
            </div>
            <div>
              <dt>Credits used (net)</dt>
              <dd>
                {credits(e.credits.net)} <small>list value {eur(Math.round(e.creditValueEurCents))}</small>
              </dd>
            </div>
            <div>
              <dt>Cash collected</dt>
              <dd>
                {eur(e.cash.collectedEurCents)} <small>{plural(e.cash.purchases, "purchase")}</small>
              </dd>
            </div>
            <div>
              <dt>Variable AI and tool cost</dt>
              <dd>
                {e.variableCost.pricedEvents === 0 ? (
                  <>
                    — <small>not priced</small>
                  </>
                ) : (
                  <>
                    {eurMicros(e.variableCost.eurMicros)} {!e.variableCost.complete && <small>lower bound</small>}
                    <small className="op-econ-split">
                      measured {eurMicros(e.variableCost.measuredEurMicros)} · estimated {eurMicros(e.variableCost.estimatedEurMicros)}
                    </small>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Cost per completed execution</dt>
              <dd>{eurMicros(e.costPerCompletedExecutionEurMicros)}</dd>
            </div>
            <div>
              <dt>Variable contribution at list value</dt>
              <dd>
                {e.variableContributionEurCents == null ? "—" : eur(Math.round(e.variableContributionEurCents))}{" "}
                {e.variableMarginPct != null && <small>{pct(e.variableMarginPct)} variable margin</small>}
              </dd>
            </div>
            <div>
              <dt>Fixed plans · payment fees</dt>
              <dd>
                {e.fixedCost.eurCents == null ? "not configured" : eur(Math.round(e.fixedCost.eurCents))}
                <small className="op-econ-split">fees {e.paymentFeesEurCents == null ? "not configured" : eur(Math.round(e.paymentFeesEurCents))}</small>
              </dd>
            </div>
            <div>
              <dt>After all known costs</dt>
              <dd>
                {e.operatingContributionEurCents == null ? "—" : eur(Math.round(e.operatingContributionEurCents))}{" "}
                {e.operatingContributionEurCents == null && <small>needs every cost priced</small>}
              </dd>
            </div>
          </dl>
          <p className="op-meta op-econ-note">
            <strong>{e.notNetProfit}</strong>{" "}
            {e.pricing.problem
              ? e.pricing.problem
              : e.pricing.configuredModels.length
                ? `Priced from PROVIDER_PRICING (${plural(e.pricing.configuredModels.length, "model")}${e.pricing.configuredTools.length ? `, ${plural(e.pricing.configuredTools.length, "tool")}` : ""}${e.pricing.asOf ? `, checked ${e.pricing.asOf}` : ", no check date"}).${e.pricing.stale ? ` These prices are ${num(e.pricing.ageDays ?? 0)} days old: re-check them.` : ""}`
                : "No prices configured (PROVIDER_PRICING): usage is recorded but not priced, so cost and margin stay blank."}
            {gaps.length > 0 && ` Not in the cost: ${gaps.join(", ")}.`} {e.creditValueNote} Excluded: {e.excludedCosts.join(", ")}.
          </p>
        </>
      )}
    </section>
  );
}

const pctOrDash = (v: number | null) => (v == null ? "—" : pct(v));

/** Market validation, last 30 days (GET /api/admin/validation): sign-up → verified result → repeat use, and feedback. */
function Validation() {
  const [v, setV] = useState<AdminValidation | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.adminValidation(30).then(setV, () => setFailed(true));
  }, []);
  if (failed) return null;
  const funnel = v
    ? ([
        ["Signed up", v.activation.signups, null],
        ["Defined an objective", v.activation.definedObjective, v.activation.rates.definedObjective],
        ["Got a completed result", v.activation.completedResult, v.activation.rates.completedResult],
        ["Got a verified result", v.activation.verifiedResult, v.activation.rates.verifiedResult],
        ["Came back (2+ days)", v.activation.cameBack, v.activation.rates.cameBack],
      ] as const)
    : [];
  const rs = v?.resultStates;
  const exc = v ? Object.entries(v.failures.exceptionsByKind).filter(([, n]) => n > 0) : [];
  return (
    <section className="op-panel op-econ" aria-labelledby="h-val" data-testid="validation-panel">
      <div className="op-chart-h" style={{ padding: "16px 18px 4px", margin: 0 }}>
        <h3 id="h-val">Market validation · last 30 days</h3>
        <span className="op-meta">internal — operator accounts excluded</span>
      </div>
      {!v ? (
        <div style={{ padding: "8px 18px 18px" }}>
          <SkeletonText lines={2} />
        </div>
      ) : (
        <>
          <ol className="op-funnel" aria-label="Activation funnel for people who signed up in the period">
            {funnel.map(([label, n, r]) => (
              <li key={label}>
                <span className="op-funnel-n">{num(n)}</span>
                <span className="op-funnel-l">{label}</span>
                {r != null && <span className="op-funnel-r">{pct(r)}</span>}
              </li>
            ))}
          </ol>
          <dl className="op-econ-grid">
            <div>
              <dt>Executions completed</dt>
              <dd>
                {num(v.executions.completed)} <small>of {num(v.executions.started)} · {pctOrDash(v.executions.completionRate)}</small>
              </dd>
            </div>
            <div>
              <dt>Verified results</dt>
              <dd>
                {num((rs?.verified ?? 0) + (rs?.verified_with_warnings ?? 0))}{" "}
                <small>
                  {num(rs?.partial ?? 0)} partial · {num(rs?.unverified ?? 0)} unverified · {num(rs?.accepted_failed_verification ?? 0)} failed & accepted
                </small>
              </dd>
            </div>
            <div>
              <dt>Outcome confirmed by a person</dt>
              <dd>
                {num(v.outcomes.confirmedByPerson)} <small>{v.outcomes.agreementRate == null ? "no confirmations yet" : `${pct(v.outcomes.agreementRate)} agree with the AI`}</small>
              </dd>
            </div>
            <div>
              <dt>Useful, per feedback</dt>
              <dd>
                {pctOrDash(v.feedback.usefulRate)} <small>{plural(v.feedback.responses, "answer")}</small>
              </dd>
            </div>
            <div>
              <dt>Credits per completed execution</dt>
              <dd>{v.credits.perCompletedExecution == null ? "—" : credits(v.credits.perCompletedExecution)}</dd>
            </div>
            <div>
              <dt>Variable cost per completed execution</dt>
              <dd>
                {eurMicros(v.variableCost.perCompletedExecutionEurMicros)} {!v.variableCost.complete && <small>incomplete pricing</small>}
              </dd>
            </div>
            <div>
              <dt>Failures</dt>
              <dd>
                {num(v.failures.executionsFailed)}{" "}
                <small>
                  {num(v.failures.stepFailures)} step failures{exc.length ? ` · ${exc.map(([k, n]) => `${num(n)} ${k.toLowerCase().replace(/_/g, " ")}`).join(" · ")}` : ""}
                </small>
              </dd>
            </div>
            <div>
              <dt>Repeat use</dt>
              <dd>
                {num(v.repeat.ranOnSeveralDays)} <small>of {plural(v.repeat.activeAccounts, "active account")} · {num(v.repeat.returningAccounts)} returning</small>
              </dd>
            </div>
          </dl>
          {v.feedback.recentComments.length > 0 && (
            <ul className="op-fb-list" aria-label="Latest feedback comments">
              {v.feedback.recentComments.map((c, i) => (
                <li key={`${c.at}-${i}`}>
                  <span className={`op-fb-v ${c.useful ? "is-up" : "is-down"}`}>{c.useful ? "Useful" : "Not useful"}</span> {c.comment}{" "}
                  <span className="op-meta">{relativeTime(c.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="op-meta op-econ-note">
            Activation follows people who signed up in the period ({plural(v.guestTrials, "guest trial")} not included); usage, outcomes and feedback cover every customer execution
            started in the period. {v.activation.medianHoursToFirstResult != null && `Median time from sign-up to a first result: ${v.activation.medianHoursToFirstResult} h.`}
          </p>
        </>
      )}
    </section>
  );
}

function Tile({
  icon,
  label,
  value,
  of,
  delta,
  meter,
  flag,
  children,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  of?: string;
  delta?: string;
  meter?: { used: number; limit: number; label: string };
  flag?: { tone: "warn" | "bad" | "gray"; text: string };
  children?: ReactNode;
}) {
  const hasLimit = !!meter && meter.limit > 0;
  const tone = hasLimit ? usageTone(meter!.used, meter!.limit) : "ok";
  const ratio = hasLimit ? Math.min(1, meter!.used / meter!.limit) : 0;
  const shownFlag =
    flag ?? (tone === "bad" ? { tone: "bad" as const, text: "Limit reached" } : tone === "warn" ? { tone: "warn" as const, text: "Near limit" } : undefined);
  return (
    <div className="op-panel op-tile">
      <div className="op-tile-h">
        <span className="op-kpi-l">
          <Icon name={icon} />
          {label}
        </span>
        {shownFlag && (
          <span className={`tag ${shownFlag.tone}`}>
            {shownFlag.tone !== "gray" && <Icon name="alert" />}
            {shownFlag.text}
          </span>
        )}
      </div>
      <div className="op-tile-v">
        {value}
        {of && <small> / {of}</small>}
        {delta && <span className="op-delta">{delta}</span>}
      </div>
      {hasLimit && (
        <div
          className="meter"
          role="meter"
          aria-label={meter!.label}
          aria-valuemin={0}
          aria-valuemax={meter!.limit}
          aria-valuenow={meter!.used}
          aria-valuetext={`${num(meter!.used)} of ${num(meter!.limit)}`}
        >
          <i className={tone === "ok" ? undefined : `is-${tone}`} style={{ width: `${Math.max(ratio > 0 ? 3 : 0, ratio * 100)}%`, transition: "width .4s ease" }} />
        </div>
      )}
      {children && <div className="op-tile-m">{children}</div>}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the operations console">
      <div className="op-tiles">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="op-panel op-tile">
            <Skeleton width="45%" height={10} />
            <Skeleton width="55%" height={26} style={{ marginTop: 10 }} />
            <Skeleton width="80%" height={10} style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="op-charts">
        {[0, 1, 2].map((i) => (
          <div key={i} className="op-panel op-chart">
            <Skeleton width="40%" height={14} />
            <Skeleton height={120} style={{ marginTop: 14 }} />
          </div>
        ))}
      </div>
      <div className="op-lanes">
        {[0, 1].map((i) => (
          <div key={i} className="op-panel op-pad">
            <SkeletonText lines={5} />
          </div>
        ))}
      </div>
    </div>
  );
}
