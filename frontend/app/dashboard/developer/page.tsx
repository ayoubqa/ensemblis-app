"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Avatar, CountUp, EmptyState, Icon, LineChart, RequireAuth, VerifiedTag } from "@/components";
import { api, type DeveloperStats } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur, num, pct } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { useIsMobile } from "@/lib/hooks";
import { DevOnly } from "../../developers/_components/DevOnly";

export default function DeveloperConsolePage() {
  return (
    <RequireAuth>
      <DevOnly>
        <Console />
      </DevOnly>
    </RequireAuth>
  );
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
};

function Console() {
  const { user } = useAuth();
  const router = useRouter();
  const mobile = useIsMobile();
  const [s, setS] = useState<DeveloperStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    api.developerStats().then(
      (r) => live && setS(r),
      (e: Error) => live && setError(e.message)
    );
    return () => {
      live = false;
    };
  }, [reload]);

  const derived = useMemo(() => {
    if (!s) return null;
    const m = s.monthly;
    const cur = m[m.length - 1] ?? { revenueCents: 0, tasks: 0, month: "" };
    const prev = m[m.length - 2] ?? { revenueCents: 0, tasks: 0, month: "" };
    const delta = prev.revenueCents > 0 ? Math.round(((cur.revenueCents - prev.revenueCents) / prev.revenueCents) * 100) : null;
    const rated = s.agents.filter((a) => a.achievedRate !== null && a.tasksRun > 0);
    const w = rated.reduce((n, a) => n + a.tasksRun, 0);
    const achieved = w ? rated.reduce((n, a) => n + (a.achievedRate as number) * a.tasksRun, 0) / w : null;
    const live = s.agents.filter((a) => a.isLive).length;
    return { cur, prev, delta, achieved, live };
  }, [s]);

  const studio = user?.company || user?.name || "Your studio";

  return (
    <div className="wrap">
      <div className="pagehead row between wrapflex" style={{ gap: 16 }}>
        <div>
          <span className="tag gray">Developer · {studio}</span>
          <h1 style={{ marginTop: 12 }}>Build once. Earn every time it works.</h1>
          <p>
            Publish a specialized agent and earn whenever a business uses it to get work done. Ensemblis brings the demand, verifies quality and
            handles payment.
          </p>
          {user?.builds && (
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Focused on: {user.builds}
            </p>
          )}
        </div>
        <div className="row wrapflex">
          <Link className="btn" href={ROUTES.economics}>
            See the economics
          </Link>
          <Link className="btn p lg" href={ROUTES.publish}>
            <Icon name="plus" />
            Publish agent
          </Link>
        </div>
      </div>

      {error && !s ? (
        <div className="notice" role="alert" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>
          <Icon name="alert" />
          <span className="sp">{error}</span>
          <button type="button" className="btn sm" onClick={() => setReload((n) => n + 1)}>
            <Icon name="redo" />
            Try again
          </button>
        </div>
      ) : !s || !derived ? (
        <ConsoleSkeleton />
      ) : (
        <>
          <div className="eyebrow">THIS MONTH</div>
          <div className="grid g4 keep2">
            <div className="stat">
              <b>
                <CountUp to={derived.cur.revenueCents / 100} prefix="€" decimals={derived.cur.revenueCents % 100 ? 2 : 0} />
              </b>
              <span>Revenue</span>{" "}
              {derived.delta !== null && (
                <em style={derived.delta < 0 ? { color: "var(--bad)" } : undefined}>
                  {derived.delta >= 0 ? "+" : "−"}
                  {Math.abs(derived.delta)}%
                </em>
              )}
            </div>
            <div className="stat">
              <b>
                <CountUp to={derived.cur.tasks} />
              </b>
              <span>Tasks</span> {derived.prev.tasks > 0 && <em>{derived.cur.tasks - derived.prev.tasks >= 0 ? "+" : "−"}{Math.abs(derived.cur.tasks - derived.prev.tasks)}</em>}
            </div>
            <div className="stat">
              <b>{eur(s.totalRevenueCents)}</b>
              <span>Lifetime revenue · {num(s.totalTasks)} tasks</span>
            </div>
            <div className="stat">
              <b>{derived.achieved === null ? "—" : pct(Math.round(derived.achieved * 10) / 10)}</b>
              <span>Outcome achieved</span>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: mobile ? "minmax(0,1fr)" : "minmax(0,1.6fr) minmax(0,1fr)", gap: 16, marginTop: 16 }}>
            <div className="card">
              <div className="row between wrapflex">
                <h3>Revenue, last 6 months</h3>
                <span className="tiny muted">Your {100 - s.platformFeePercent}% share of completed tasks</span>
              </div>
              {s.monthly.some((m) => m.revenueCents > 0) ? (
                <LineChart
                  values={s.monthly.map((m) => m.revenueCents / 100)}
                  xLabels={s.monthly.map((m) => monthLabel(m.month))}
                  label="Monthly revenue"
                  height={160}
                  format={(v) => eur(Math.round(v * 100))}
                />
              ) : (
                <div className="rel">
                  <div style={{ opacity: 0.35 }} aria-hidden="true">
                    <LineChart values={s.monthly.map(() => 0)} xLabels={s.monthly.map((m) => monthLabel(m.month))} height={160} />
                  </div>
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 16 }}>
                    <div>
                      <b className="small">No revenue yet</b>
                      <div className="tiny muted">It shows up here as soon as customers complete tasks with your agents.</div>
                    </div>
                  </div>
                </div>
              )}
              <div className="row wrapflex tiny muted" style={{ gap: 14, marginTop: 10 }}>
                {s.monthly.map((m) => (
                  <span key={m.month}>
                    {monthLabel(m.month)} <b style={{ color: "var(--ink)" }}>{num(m.tasks)}</b> tasks
                  </span>
                ))}
              </div>
            </div>
            <LaunchChecklist s={s} />
          </div>

          <div className="row between" style={{ margin: "26px 0 10px" }}>
            <div className="eyebrow" style={{ margin: 0 }}>
              MY AGENTS · {derived.live} LIVE
            </div>
            <Link className="btn sm p" href={ROUTES.publish}>
              <Icon name="plus" />
              Publish agent
            </Link>
          </div>
          {s.agents.length === 0 ? (
            <EmptyState icon="code" title="You haven't published an agent yet." action={{ label: "Publish your first agent", href: ROUTES.publish, icon: "plus" }}>
              It takes a few minutes: describe what it does, write its instructions, set a price, and it&apos;s live in the marketplace.
            </EmptyState>
          ) : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Tasks</th>
                    <th>Achieved</th>
                    <th>Revenue</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.agents.map((a) => {
                    const href = `/developers/agents/${encodeURIComponent(a.id)}`;
                    return (
                      <tr key={a.id} className="tr-click" onClick={() => router.push(href)}>
                        <td>
                          <div className="row" style={{ gap: 10 }}>
                            <Avatar name={a.name} hue={a.hue} size="sm" />
                            <div style={{ minWidth: 0 }}>
                              <Link href={href} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>
                                {a.name}
                              </Link>
                              <div className="tiny muted">{a.category}</div>
                            </div>
                            <VerifiedTag verified={a.verified} compact />
                          </div>
                        </td>
                        <td>
                          <span className={a.isLive ? "tag ok" : "tag warn"}>
                            {a.isLive && <span className="pulse" style={{ width: 6, height: 6 }} />}
                            {a.isLive ? "Live" : "Paused"}
                          </span>
                        </td>
                        <td>{eur(a.pricePerTaskCents)}</td>
                        <td>{a.tasksRun ? num(a.tasksRun) : "—"}</td>
                        <td>{a.achievedRate === null ? "—" : pct(a.achievedRate)}</td>
                        <td>
                          <b>{a.revenueCents ? eur(a.revenueCents) : "—"}</b>
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <Link className="btn sm" href={href} onClick={(e) => e.stopPropagation()}>
                            Manage
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Revenue is your {100 - s.platformFeePercent}% share of completed tasks your agents led. Platform fee {s.platformFeePercent}%. Demo
            credits, no real payouts.
          </p>
        </>
      )}
    </div>
  );
}

function LaunchChecklist({ s }: { s: DeveloperStats }) {
  const items: [string, boolean][] = [
    ["Create a developer account", true],
    ["Publish your first agent", s.agents.length > 0],
    ["Complete your first task", s.totalTasks > 0],
    ["Get your first customer rating", s.agents.some((a) => a.achievedRate !== null)],
    ["Earn the Verified badge", s.agents.some((a) => a.verified)],
  ];
  const done = items.filter(([, d]) => d).length;
  const next = items.findIndex(([, d]) => !d);
  return (
    <div className="card">
      <div className="row between">
        <h3>Launch checklist</h3>
        <span className="tiny muted">
          {done}/{items.length}
        </span>
      </div>
      <div className="progress" style={{ margin: "10px 0 4px" }}>
        <i style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="chk" style={{ padding: 0 }}>
        {items.map(([l, d], i) => (
          <li key={l} className={d ? "done" : i === next ? "doing" : ""} style={{ padding: "7px 0", fontSize: 14 }}>
            <span className="ic" style={i === next ? { animation: "none", borderTopColor: "var(--accent)" } : undefined}>
              <Icon name="check" />
            </span>
            {l}
          </li>
        ))}
      </ul>
      {next === 1 && (
        <Link className="btn p sm" href={ROUTES.publish} style={{ marginTop: 8 }}>
          Publish an agent
        </Link>
      )}
      {next === 2 && (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          Tip: run a task with your own agent from its public page to see it work end to end.
        </p>
      )}
    </div>
  );
}

function ConsoleSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading developer stats">
      <div className="grid g4 keep2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat">
            <div className="sk" style={{ height: 30, width: "60%" }} />
            <div className="sk" style={{ height: 10, width: "40%", marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="sk" style={{ height: 240, borderRadius: 16, marginTop: 16 }} />
      <div className="sk" style={{ height: 180, borderRadius: 16, marginTop: 26 }} />
    </div>
  );
}

