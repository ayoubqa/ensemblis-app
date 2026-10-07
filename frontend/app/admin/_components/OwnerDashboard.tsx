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
import { GalleryManager } from "./GalleryManager";

const REFRESH_MS = 60_000;

/** The real owner dashboard (ADMIN_EMAILS only). Reads GET /api/admin/overview. */
export function OwnerDashboard({ onPreviewDemo }: { onPreviewDemo: () => void }) {
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
    document.title = "Owner dashboard · Ensemblis";
  }, []);

  const forbidden = error instanceof ApiError && (error.status === 403 || error.status === 401);

  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="pagehead row between wrapflex" style={{ alignItems: "flex-end", gap: 14 }}>
        <div>
          <span className="tag ok">
            <span className="pulse" aria-hidden="true" />
            Owner dashboard · live data
          </span>
          <h1 style={{ marginTop: 12 }}>How Ensemblis is doing</h1>
          <p>
            {data ? (
              <>
                Updated <span title={dateTime(data.generatedAt)}>{relativeTime(data.generatedAt)}</span> · refreshes every minute. Days are counted in UTC.
              </>
            ) : (
              "Usage, limits, money and quality for this deployment, at a glance."
            )}
          </p>
        </div>
        <div className="row wrapflex">
          <button type="button" className="btn ghost sm" onClick={onPreviewDemo} title="See the illustrative console that other visitors get">
            Preview demo console
          </button>
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
              ? "The server didn't recognise this account as an owner. Check that your email is listed in ADMIN_EMAILS on the backend, then sign in again."
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

      {!data ? error != null ? null : <DashboardSkeleton /> : <Body d={data} reload={() => load()} />}
    </div>
  );
}

// ------------------------------------------------------------------ body
function Body({ d, reload }: { d: AdminOverview; reload: () => Promise<void> }) {
  const users = d.users;
  const tasks = d.tasks;
  const ai = d.ai;
  const search = d.search;
  const signups14 = sumDays(users.signupsLast14d);
  const tokensToday = (ai.tokensInToday || 0) + (ai.tokensOutToday || 0);
  const settled = tasks.completed + tasks.failed;
  const successRate = settled ? Math.round((tasks.completed / settled) * 1000) / 10 : null;
  const signupDays = users.signupsLast14d ?? [];
  const tokenDays = ai.tokensLast14d ?? [];
  const topAgents = d.topAgents ?? [];
  const failures = d.recentFailures ?? [];
  const recentUsers = d.recentUsers ?? [];
  const maxRuns = Math.max(1, ...topAgents.map((a) => a.runs));

  return (
    <>
      {/* KPI tiles */}
      <h2 className="sr-only">Today at a glance</h2>
      <div className="grid g4 keep2">
        <Tile icon="user" label="Users" value={num(users.total)} delta={signups14 ? `+${num(signups14)} in 14 days` : undefined}>
          {num(users.guests)} guests · {num(users.developers)} developers
        </Tile>
        <Tile
          icon="zap"
          label="Tasks today"
          value={num(tasks.runsToday)}
          of={tasks.dailyCapGlobal > 0 ? num(tasks.dailyCapGlobal) : undefined}
          meter={{ used: tasks.runsToday, limit: tasks.dailyCapGlobal, label: "Tasks today against the global daily cap" }}
        >
          {tasks.running > 0 ? (
            <span className="row" style={{ gap: 6, display: "inline-flex" }}>
              <i className="pulse" aria-hidden="true" />
              {num(tasks.running)} running now
            </span>
          ) : tasks.dailyCapGlobal > 0 ? (
            "against the global daily cap"
          ) : (
            "No global daily cap set"
          )}
        </Tile>
        <Tile icon="spark" label="AI calls today" value={num(ai.callsToday)} flag={ai.failuresToday > 0 ? { tone: "bad", text: `${num(ai.failuresToday)} failed` } : undefined}>
          {ai.providerLabel || "AI provider"}
        </Tile>
        <Tile icon="layers" label="AI tokens today" value={compact(tokensToday)}>
          {compact(ai.tokensInToday)} in · {compact(ai.tokensOutToday)} out
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
          {d.email.enabled ? "Task-done notices and password resets" : "Set up email on the backend to send them"}
        </Tile>
        <Tile icon="eur" label="Purchases" value={eur(d.money.purchasesCents)}>
          {plural(d.money.purchasesCount, "Stripe payment")} · {eur(d.money.demoTopupsCents)} demo top-ups
        </Tile>
        <Tile
          icon="check"
          label="Task success"
          value={pct(successRate)}
          flag={successRate !== null && successRate < 80 && settled >= 5 ? { tone: "warn", text: "Below 80%" } : undefined}
        >
          {num(tasks.completed)} completed · {num(tasks.failed)} failed · {num(tasks.total)} total
        </Tile>
      </div>

      {/* 14-day charts */}
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
            <h3 style={{ margin: 0 }}>Tasks</h3>
            <span className="tiny muted">last 14 days</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <DailyBars completed={tasks.completedLast14d ?? []} failed={tasks.failedLast14d ?? []} height={140} label="Completed and failed tasks per day, last 14 days" />
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

      {/* Agents + failures */}
      <div className="grid g2" style={{ marginTop: 16, alignItems: "start" }}>
        <section className="card tight" aria-labelledby="h-top-agents" style={{ minWidth: 0 }}>
          <div className="row between">
            <h3 id="h-top-agents" style={{ margin: 0 }}>
              Top agents
            </h3>
            <span className="tiny muted">by runs</span>
          </div>
          {topAgents.length === 0 ? (
            <p className="small muted" style={{ marginTop: 10 }}>
              No agent has run a real task yet.
            </p>
          ) : (
            <div className="tw" style={{ marginTop: 10, border: 0 }}>
              {/* Half-width card: let this 3-column table shrink (the global 560px minimum would hide "Achieved"). */}
              <table style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th style={{ textAlign: "right" }}>Runs</th>
                    <th style={{ textAlign: "right" }}>Achieved</th>
                  </tr>
                </thead>
                <tbody>
                  {topAgents.slice(0, 8).map((a) => (
                    <tr key={a.agentId}>
                      <td style={{ whiteSpace: "normal" }}>
                        <div className="row" style={{ gap: 10 }}>
                          <Avatar name={a.name} size="sm" />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <Link href={ROUTES.agent(a.agentId)} style={{ fontWeight: 600, color: "inherit" }}>
                              {a.name}
                            </Link>
                            <div style={{ marginTop: 5, height: 5, maxWidth: 220, background: "var(--line)", borderRadius: 5, overflow: "hidden" }} aria-hidden="true">
                              <i style={{ display: "block", height: "100%", width: `${(a.runs / maxRuns) * 100}%`, background: "var(--accent)", borderRadius: 5 }} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(a.runs)}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={a.achievedRate === null ? "No ratings yet" : undefined}>
                        {pct(a.achievedRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card tight" aria-labelledby="h-failures" style={{ minWidth: 0 }}>
          <div className="row between">
            <h3 id="h-failures" style={{ margin: 0 }}>
              Recent failures
            </h3>
            {failures.length > 0 && <span className="tag bad">{num(failures.length)}</span>}
          </div>
          {failures.length === 0 ? (
            <p className="small muted row" style={{ marginTop: 10, gap: 8 }}>
              <Icon name="check" style={{ color: "var(--ok)" }} />
              No failed tasks recently.
            </p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {failures.slice(0, 8).map((f) => (
                <div key={f.taskId + f.at} className="lane" style={{ alignItems: "flex-start", padding: "10px 4px" }}>
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
      </div>

      {/* Recent users */}
      <section aria-labelledby="h-users" style={{ marginTop: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h3 id="h-users" style={{ margin: 0 }}>
            Recent users
          </h3>
          <span className="tiny muted">newest first</span>
        </div>
        {recentUsers.length === 0 ? (
          <EmptyState icon="user" title="No users yet">
            New accounts and guest trials will appear here.
          </EmptyState>
        ) : (
          <div className="tw">
            <table style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Type</th>
                  <th>Joined</th>
                  <th style={{ textAlign: "right" }}>Tasks</th>
                </tr>
              </thead>
              <tbody>
                {recentUsers.slice(0, 12).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <Avatar name={u.isGuest ? "Guest" : u.name} size="xs" round />
                        <b className="small">{u.isGuest ? "Guest" : u.name}</b>
                      </div>
                    </td>
                    <td className="small" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={u.email}>
                      {u.isGuest ? <span className="muted">—</span> : u.email}
                    </td>
                    <td>
                      {u.isGuest ? (
                        <span className="tag warn">Guest</span>
                      ) : (
                        <span className={u.accountType === "DEVELOPER" ? "tag" : "tag gray"}>{u.accountType === "DEVELOPER" ? "Developer" : "Company"}</span>
                      )}
                    </td>
                    <td className="small" title={dateTime(u.createdAt)}>
                      {relativeTime(u.createdAt)}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(u.tasks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <GalleryManager shareable={d.shareableReports ?? []} gallery={d.gallery ?? []} onChanged={reload} />

      <p className="tiny muted" style={{ marginTop: 22 }}>
        Counts come straight from this deployment&apos;s database. “Today” and the 14-day charts use UTC days. Money: Stripe purchases are real payments;
        demo top-ups are free credits.
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
