"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Icon, LineChart, Skeleton, SkeletonText, useToast, type IconName } from "@/components";
import { api, ApiError, type AdminOverview } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { eur, num, pct, plural, relativeTime, dateTime } from "@/lib/format";
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
          {plural(d.money.purchasesCount, "Stripe payment")} · {eur(d.money.demoTopupsCents)} demo top-ups
        </Tile>
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


/** KPI tile: label, big value (optionally "/ limit"), muted context line, optional usage meter or flag. */
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
