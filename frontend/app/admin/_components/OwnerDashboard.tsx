"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Avatar, EmptyState, Icon, LineChart, Skeleton, SkeletonText, useToast, type IconName } from "@/components";
import { api, ApiError, type AdminOverview } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { eur, num, pct, plural, relativeTime, dateTime } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { compact, dayLabelUTC, sumDays, usageTone } from "./adminFormat";
import { DailyBars } from "./DailyBars";

const REFRESH_MS = 60_000;

/** The real owner dashboard (ADMIN_EMAILS only). Reads GET /api/admin/overview. */
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
        if (manual) toast("Dashboard refreshed", { icon: "check" });
      } catch (e) {
        setError(e);
        if (manual) toast.error(errorText(e, "Couldn't refresh the dashboard"));
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
  useEffect(() => {
    document.title = "Operations · Ensemblis";
  }, []);

  const forbidden = error instanceof ApiError && (error.status === 403 || error.status === 401);

  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="pagehead row between wrapflex" style={{ alignItems: "flex-end", gap: 14 }}>
        <div>
          <span className="tag ok">
            <span className="pulse" aria-hidden="true" />
            Operations · live data
          </span>
          <h1 style={{ marginTop: 12 }}>How this deployment is running</h1>
          <p>
            {data ? (
              <>
                Updated <span title={dateTime(data.generatedAt)}>{relativeTime(data.generatedAt)}</span> · refreshes every minute. Days are counted in UTC.
              </>
            ) : (
              "Executions, queue health, verification, AI usage and money for this deployment."
            )}
          </p>
        </div>
        <div className="row wrapflex">
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
              ? "The server didn't recognise this account as an operator. Your email must be listed in ADMIN_EMAILS on the backend and verified."
              : data
                ? `Couldn't refresh (${errorText(error)}). Showing data from ${relativeTime(data.generatedAt)}.`
                : errorText(error, "Couldn't load the dashboard.")}
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
      <div className="grid g4 keep2">
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
          label="Job queue"
          value={num(q.queued)}
          flag={q.deadLast24h > 0 ? { tone: "bad", text: `${num(q.deadLast24h)} dead (24h)` } : queueStale ? { tone: "warn", text: "Backlog" } : undefined}
        >
          {num(q.running)} running · oldest queued {q.queued ? `${num(q.oldestQueuedSeconds)}s` : "—"}
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
        <Tile icon="spark" label="AI calls today" value={num(ai.callsToday)} flag={ai.failuresToday > 0 ? { tone: "bad", text: `${num(ai.failuresToday)} failed` } : undefined}>
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
      <div className="grid g3" style={{ marginTop: 16, alignItems: "stretch" }}>
        <div className="card">
          <div className="row between" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Sign-ups</h3>
            <span className="tiny muted">{num(signups14)} in 14 days</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <LineChart
              values={signupDays.map((x) => x.count)}
              xLabels={signupDays.map((x) => dayLabelUTC(x.day))}
              height={140}
              label={`New accounts per day, last 14 days: ${num(signups14)} in total`}
              format={(v) => `${num(v)} sign-up${v === 1 ? "" : "s"}`}
            />
          </div>
        </div>
        <div className="card">
          <div className="row between" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Executions</h3>
            <span className="tiny muted">last 14 days</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <DailyBars completed={ex.completedLast14d ?? []} failed={ex.failedLast14d ?? []} height={140} label="Completed and failed executions per day, last 14 days" />
          </div>
        </div>
        <div className="card">
          <div className="row between" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>AI tokens</h3>
            <span className="tiny muted">{compact(sumDays(tokenDays))} in 14 days</span>
          </div>
          <div style={{ marginTop: 12 }}>
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

      <div className="grid g2" style={{ marginTop: 16, alignItems: "start" }}>
        <section className="card tight" aria-labelledby="h-failures" style={{ minWidth: 0 }}>
          <div className="row between">
            <h3 id="h-failures" style={{ margin: 0 }}>
              Recent failed executions
            </h3>
            {failures.length > 0 && <span className="tag bad">{num(failures.length)}</span>}
          </div>
          {failures.length === 0 ? (
            <p className="small muted row" style={{ marginTop: 10, gap: 8 }}>
              <Icon name="check" style={{ color: "var(--ok)" }} />
              No failed executions recently.
            </p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {failures.slice(0, 8).map((f) => (
                <div key={f.executionId} className="lane" style={{ alignItems: "flex-start", padding: "10px 4px" }}>
                  <span style={{ color: "var(--bad)", flex: "none", marginTop: 2 }}>
                    <Icon name="alert" label="Failed" />
                  </span>
                  <div className="sp" style={{ minWidth: 0 }}>
                    <b className="small" style={{ display: "block", overflowWrap: "anywhere" }}>
                      {f.title}
                    </b>
                    <div className="tiny muted" style={clamp2} title={f.error}>
                      {f.error || "No error message recorded"}
                    </div>
                  </div>
                  <span className="tiny muted" style={{ flex: "none", whiteSpace: "nowrap" }} title={dateTime(f.at)}>
                    {relativeTime(f.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card tight" aria-labelledby="h-users" style={{ minWidth: 0 }}>
          <div className="row between">
            <h3 id="h-users" style={{ margin: 0 }}>
              Recent users
            </h3>
            <span className="tiny muted">newest first</span>
          </div>
          {recentUsers.length === 0 ? (
            <p className="small muted" style={{ marginTop: 10 }}>
              No users yet.
            </p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {recentUsers.slice(0, 10).map((u) => (
                <div key={u.id} className="lane" style={{ padding: "8px 4px" }}>
                  <Avatar name={u.isGuest ? "Guest" : u.name} size="xs" round />
                  <div className="sp" style={{ minWidth: 0 }}>
                    <b className="small">{u.isGuest ? "Guest" : u.name}</b>
                    {!u.isGuest && (
                      <div className="tiny muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={u.email}>
                        {u.email}
                      </div>
                    )}
                  </div>
                  {u.isGuest ? <span className="tag warn">Guest</span> : u.verified ? <span className="tag ok">Verified</span> : <span className="tag gray">Unverified</span>}
                  <span className="tiny muted" style={{ flex: "none", whiteSpace: "nowrap" }} title={dateTime(u.createdAt)}>
                    {relativeTime(u.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="tiny muted" style={{ marginTop: 22 }}>
        Counts come straight from this deployment&apos;s database. “Today” and the 14-day charts use UTC days. Money: Stripe purchases are real payments;
        demo top-ups are free balance.
      </p>
    </>
  );
}

const clamp2: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  overflowWrap: "anywhere",
};

const TONE_COLOR = { ok: "var(--accent)", warn: "var(--warn)", bad: "var(--bad)" } as const;

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
    <div className="card tight" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div className="row between wrapflex" style={{ gap: 4 }}>
        <div className="tiny muted row" style={{ gap: 6, fontWeight: 600 }}>
          <Icon name={icon} size={14} />
          {label}
        </div>
        {shownFlag && (
          <span className={`tag ${shownFlag.tone}`} style={{ padding: "1px 7px", fontSize: 11 }}>
            {shownFlag.tone !== "gray" && <Icon name="alert" />}
            {shownFlag.text}
          </span>
        )}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>
        {value}
        {of && <small style={{ fontSize: 15, fontWeight: 500, color: "var(--muted)" }}> / {of}</small>}
        {delta && (
          <small style={{ fontSize: 12, fontWeight: 600, color: "var(--ok)", marginLeft: 8, letterSpacing: 0 }}>{delta}</small>
        )}
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
          style={{ margin: "4px 0 2px" }}
        >
          <i style={{ width: `${Math.max(ratio > 0 ? 3 : 0, ratio * 100)}%`, background: TONE_COLOR[tone], transition: "width .4s ease" }} />
        </div>
      )}
      {children && <div className="tiny muted" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</div>}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the owner dashboard">
      <div className="grid g4 keep2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card tight">
            <Skeleton width="45%" height={10} />
            <Skeleton width="55%" height={26} style={{ marginTop: 10 }} />
            <Skeleton width="80%" height={10} style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="grid g3" style={{ marginTop: 16 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="card">
            <Skeleton width="40%" height={14} />
            <Skeleton height={120} style={{ marginTop: 14 }} />
          </div>
        ))}
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        {[0, 1].map((i) => (
          <div key={i} className="card tight">
            <SkeletonText lines={5} />
          </div>
        ))}
      </div>
    </div>
  );
}
