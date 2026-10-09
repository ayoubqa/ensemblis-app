"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api, type Briefing } from "@/lib/api";
import { EmptyState, Icon, Meter, OutcomeTag, RequireAuth, Skeleton, Tag, VerificationTag, useShell } from "@/components";
import { ApprovalCard, ExceptionCard, ExecBadge } from "@/components/ops";
import { eur, greeting, plural, relativeTime } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import { LOOP } from "@/lib/data";
import { ROUTES } from "@/lib/routes";

export default function DashboardPage() {
  return (
    <RequireAuth>
      <ChiefOfStaff />
    </RequireAuth>
  );
}

type Activity = Briefing["team"]["activity"][number];

/** Event types that deserve a coloured marker in the activity feed (the text always says what happened). */
const TONE: Record<string, "ok" | "warn" | "bad"> = {
  EXECUTION_COMPLETED: "ok",
  VERIFICATION_COMPLETED: "ok",
  APPROVAL_REQUESTED: "warn",
  EXCEPTION_CREATED: "bad",
  STEP_FAILED: "bad",
  EXECUTION_FAILED: "bad",
};

/** Newest events, grouped by objective so each title is shown once. */
function groupActivity(events: Activity[], maxGroups = 4, perGroup = 3) {
  const groups: { objectiveId: string; objectiveTitle: string; events: Activity[]; total: number }[] = [];
  for (const e of [...events].sort((a, b) => b.id - a.id)) {
    let g = groups.find((x) => x.objectiveId === e.objectiveId);
    if (!g) {
      if (groups.length >= maxGroups) continue;
      g = { objectiveId: e.objectiveId, objectiveTitle: e.objectiveTitle, events: [], total: 0 };
      groups.push(g);
    }
    g.total += 1;
    if (g.events.length < perGroup) g.events.push(e);
  }
  return groups;
}

function ChiefOfStaff() {
  const { attention: counts } = useShell();
  const [b, setB] = useState<Briefing | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setB(await api.briefing());
      setFailed(false);
    } catch (e) {
      setFailed(true);
      throw e;
    }
  }, []);
  // An overview, not a ticker: refresh every 30s while visible.
  usePolling(load, 30_000);
  // After an approval or exception is handled on this page.
  const refresh = useCallback(() => void load().catch(() => undefined), [load]);

  if (!b) {
    return failed ? (
      <div className="wrap ws-page">
        <EmptyState icon="alert" title="Your overview couldn't be loaded" action={{ label: "Try again", onClick: refresh, icon: "redo" }}>
          The Chief of Staff is unreachable right now. Your objectives and executions are unaffected.
        </EmptyState>
      </div>
    ) : (
      <HomeSkeleton />
    );
  }

  const shownApprovals = b.attention.approvals.length;
  const shownExceptions = b.attention.exceptions.length;
  // The overview lists at most 5 of each; the shell's counts are the real totals.
  const approvals = Math.max(shownApprovals, counts?.approvals ?? 0);
  const exceptions = Math.max(shownExceptions, counts?.exceptions ?? 0);
  const attention = approvals + exceptions;
  const fresh = b.objectives.total === 0;
  const inProgress = b.objectives.active;
  const progressParts = [
    b.objectives.running ? `${b.objectives.running} being worked on` : null,
    b.objectives.waiting ? `${b.objectives.waiting} awaiting approval` : null,
    b.objectives.blocked ? `${b.objectives.blocked} blocked` : null,
  ].filter(Boolean);
  const attentionHref = approvals ? ROUTES.approvals : exceptions ? ROUTES.exceptions : `${ROUTES.objectives}?group=attention`;
  const activity = groupActivity(b.team.activity);

  const summary = fresh
    ? "Your AI Team is ready for its first objective. The Chief of Staff plans it, assigns the work and brings you a verified result."
    : [
        attention ? `${plural(attention, "item")} ${attention === 1 ? "needs" : "need"} your decision.` : "Nothing needs you right now.",
        b.objectives.running ? `${plural(b.objectives.running, "objective")} ${b.objectives.running === 1 ? "is" : "are"} being worked on.` : null,
      ]
        .filter(Boolean)
        .join(" ");

  return (
    <div className="wrap ws-page ws-home" data-testid="briefing">
      <header className="ws-hero">
        <div className="eyebrow">
          <Icon name="compass" size={14} />
          Chief of Staff · {b.orgName}
        </div>
        <h1>
          {greeting()}, {b.greetingName}.
        </h1>
        <p>{summary}</p>
      </header>

      {fresh ? (
        <FreshStart filled={b.context.filled} total={b.context.total} />
      ) : (
        <>
          <section className="ws-glance" aria-label="At a glance">
            <Link href={attentionHref} className={attention ? "ws-kpi hot" : "ws-kpi"}>
              <span className="ws-kpi-l">Needs you</span>
              <b>{attention}</b>
              <em>
                {plural(approvals, "approval")} · {plural(exceptions, "exception")}
              </em>
            </Link>
            <Link href={`${ROUTES.objectives}?group=active`} className="ws-kpi">
              <span className="ws-kpi-l">In progress</span>
              <b>{inProgress}</b>
              <em>{progressParts.length ? progressParts.join(" · ") : "Nothing in progress"}</em>
            </Link>
            <Link href={ROUTES.reports} className="ws-kpi">
              <span className="ws-kpi-l">Completed</span>
              <b>{b.objectives.completed}</b>
              <em>{plural(b.value30d.criteriaMet, "success criterion", "success criteria")} met in 30 days</em>
            </Link>
            <Link href={ROUTES.usage} className="ws-kpi">
              <span className="ws-kpi-l">Spend this month</span>
              <b>{eur(b.usage.monthSpendCents)}</b>
              <em>
                {plural(b.usage.executionsThisMonth, "execution")} · {eur(b.usage.balanceCents)} balance
              </em>
            </Link>
          </section>

          {shownApprovals + shownExceptions > 0 && (
            <section className="ws-sec ws-attn" aria-labelledby="ws-attn-h">
              <div className="ws-sec-head">
                <h2 id="ws-attn-h">
                  <span className="ws-attn-dot" aria-hidden="true" />
                  Needs your decision
                  <span className="ws-count">
                    <span className="sr-only">: </span>
                    {attention}
                    <span className="sr-only"> {attention === 1 ? "item" : "items"}</span>
                  </span>
                </h2>
                <div className="ws-sec-links">
                  {approvals > 0 && (
                    <Link href={ROUTES.approvals} className="ws-link">
                      Approvals <Icon name="arrow" size={14} />
                    </Link>
                  )}
                  {exceptions > 0 && (
                    <Link href={ROUTES.exceptions} className="ws-link">
                      Exceptions <Icon name="arrow" size={14} />
                    </Link>
                  )}
                </div>
              </div>
              <div className="ws-attn-list">
                {b.attention.approvals.map((a) => (
                  <ApprovalCard key={a.id} approval={a} onDone={refresh} showObjective />
                ))}
                {b.attention.exceptions.map((x) => (
                  <ExceptionCard key={x.id} exception={x} onDone={refresh} showObjective />
                ))}
              </div>
              {attention > shownApprovals + shownExceptions && (
                <p className="ws-note">
                  Showing {shownApprovals + shownExceptions} of {attention}. The rest are in{" "}
                  <Link href={ROUTES.approvals}>Approvals</Link> and <Link href={ROUTES.exceptions}>Exceptions</Link>.
                </p>
              )}
            </section>
          )}

          <div className="ws-home-grid">
            <div className="ws-home-main">
              <section className="ws-sec" aria-labelledby="ws-live-h">
                <div className="ws-sec-head">
                  <h2 id="ws-live-h">
                    Live executions
                    {b.team.working.length > 0 && <span className="ws-count">{b.team.working.length}</span>}
                  </h2>
                  <Link href={`${ROUTES.objectives}?group=active`} className="ws-link">
                    In progress <Icon name="arrow" size={14} />
                  </Link>
                </div>
                {b.team.working.length ? (
                  <ul className="ws-panel ws-live">
                    {b.team.working.map((w) => (
                      <li key={`${w.objectiveId}:${w.stepTitle}:${w.agent}`}>
                        <Link href={ROUTES.objective(w.objectiveId)} className="ws-live-row">
                          <ExecBadge executive={w.executive} size={34} />
                          <span className="ws-live-txt">
                            <span className="ws-live-step">{w.stepTitle}</span>
                            <span className="ws-live-who">
                              <b>{w.agent}</b> · {w.executiveTitle}
                            </span>
                            <span className="ws-live-obj">{w.objectiveTitle}</span>
                          </span>
                          <span className="ws-live-state">
                            <Tag>
                              <span className="pulse" aria-hidden="true" />
                              Working
                            </Tag>
                            {w.startedAt && <span className="ws-meta">since {relativeTime(w.startedAt)}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="ws-panel ws-quiet">
                    <Icon name="layers" size={18} />
                    <p>
                      No step is executing right now.
                      {b.objectives.waiting > 0 && (
                        <>
                          {" "}
                          {plural(b.objectives.waiting, "plan is", "plans are")} waiting for your approval.
                        </>
                      )}
                    </p>
                  </div>
                )}
              </section>

              <section className="ws-sec" aria-labelledby="ws-out-h">
                <div className="ws-sec-head">
                  <h2 id="ws-out-h">Recent outcomes</h2>
                  <Link href={ROUTES.reports} className="ws-link">
                    All reports <Icon name="arrow" size={14} />
                  </Link>
                </div>
                {b.recentOutcomes.length ? (
                  <ul className="ws-panel ws-outcomes">
                    {b.recentOutcomes.map((r) => (
                      <li key={r.executionId}>
                        <Link href={ROUTES.objective(r.objectiveId)} className="ws-out-row">
                          <span className="ws-out-main">
                            <span className="ws-out-t">{r.objectiveTitle}</span>
                            {r.outcomeSummary && <span className="ws-out-s">{r.outcomeSummary}</span>}
                            <span className="ws-meta">
                              {eur(r.costCents, { decimals: true })} · {relativeTime(r.completedAt)}
                            </span>
                          </span>
                          <span className="ws-tags">
                            <OutcomeTag outcome={r.outcomeStatus} />
                            <VerificationTag status={r.verificationStatus} score={r.verificationScore} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="ws-panel ws-quiet">
                    <Icon name="flag" size={18} />
                    <p>No completed outcomes yet. Completed objectives appear here with their verification and outcome.</p>
                  </div>
                )}
              </section>
            </div>

            <aside className="ws-home-side" aria-label="Activity and Company Context">
              <section className="ws-panel ws-side-card" aria-labelledby="ws-act-h">
                <h2 id="ws-act-h" className="ws-side-h">
                  Activity
                </h2>
                {activity.length ? (
                  <div className="ws-act">
                    {activity.map((g) => (
                      <div className="ws-act-g" key={g.objectiveId}>
                        <Link href={ROUTES.objective(g.objectiveId)} className="ws-act-obj">
                          {g.objectiveTitle}
                        </Link>
                        <ol>
                          {g.events.map((e) => (
                            <li key={e.id} className={TONE[e.type] ? `t-${TONE[e.type]}` : undefined}>
                              <span className="ws-act-msg">
                                <b>{e.actorTitle}</b> {e.message}
                              </span>
                              <time dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()}>
                                {relativeTime(e.createdAt)}
                              </time>
                            </li>
                          ))}
                        </ol>
                        {g.total > g.events.length && (
                          <Link href={ROUTES.objective(g.objectiveId)} className="ws-act-more">
                            {plural(g.total - g.events.length, "earlier event")}
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ws-muted">Nothing has happened yet.</p>
                )}
              </section>

              <section className="ws-panel ws-side-card" aria-labelledby="ws-ctx-h">
                <h2 id="ws-ctx-h" className="ws-side-h">
                  Company Context
                </h2>
                <div className="ws-ctx-row">
                  <b>
                    {b.context.filled}/{b.context.total}
                  </b>
                  <span>sections complete</span>
                </div>
                <Meter value={b.context.total ? (b.context.filled / b.context.total) * 100 : 0} label="Company Context completeness" />
                {b.context.missing.length > 0 ? (
                  <p className="ws-muted">Missing: {b.context.missing.join(", ")}</p>
                ) : (
                  <p className="ws-muted">Every objective is planned with it automatically.</p>
                )}
                <Link href={ROUTES.context} className="ws-link">
                  Open Company Context <Icon name="arrow" size={14} />
                </Link>
                {b.value30d.estimatedHoursReturned > 0 && (
                  <div className="ws-estimate">
                    <Tag variant="gray">Estimate</Tag>
                    <p>
                      ≈{b.value30d.estimatedHoursReturned}h of analyst work in the last 30 days, from the Chief of Staff&apos;s planning estimates. Not measured time.
                    </p>
                  </div>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/** A new organization: what to do first, and how an outcome is delivered. */
function FreshStart({ filled, total }: { filled: number; total: number }) {
  return (
    <section className="ws-fresh" aria-labelledby="ws-fresh-h">
      <div className="ws-fresh-main">
        <h2 id="ws-fresh-h">Tell the Chief of Staff what you want to achieve.</h2>
        <p>Describe the result in plain language, how success will be judged, a deadline and a budget. You approve the plan and its cost before any work starts.</p>
        <div className="ws-fresh-actions">
          <Link href={ROUTES.newObjective} className="btn p lg">
            <Icon name="plus" />
            Define your first outcome
          </Link>
          {filled < total && (
            <Link href={ROUTES.context} className="btn lg">
              Complete your Company Context ({filled}/{total})
            </Link>
          )}
        </div>
      </div>
      <div className="ws-fresh-loop">
        <h3>How the Chief of Staff delivers an outcome</h3>
        <ol>
          {LOOP.map((s, i) => (
            <li key={s.key}>
              <span className="ws-step-n" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <b>{s.title}</b>
                <span>{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="wrap ws-page" aria-busy="true" aria-label="Loading">
      <div className="ws-hero">
        <Skeleton height={12} width={220} />
        <Skeleton height={40} width="min(420px, 80%)" radius={10} style={{ marginTop: 14 }} />
        <Skeleton height={14} width="min(520px, 90%)" style={{ marginTop: 14 }} />
      </div>
      <div className="ws-glance">
        {[0, 1, 2, 3].map((i) => (
          <div className="ws-kpi" key={i}>
            <Skeleton height={10} width="50%" />
            <Skeleton height={26} width="34%" style={{ marginTop: 12 }} />
            <Skeleton height={10} width="80%" style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="ws-home-grid" style={{ marginTop: 32 }}>
        <div className="ws-panel" style={{ padding: 22 }}>
          <Skeleton height={14} width="40%" />
          <Skeleton height={12} style={{ marginTop: 16 }} />
          <Skeleton height={12} width="80%" style={{ marginTop: 10 }} />
          <Skeleton height={12} width="60%" style={{ marginTop: 10 }} />
        </div>
        <div className="ws-panel" style={{ padding: 22 }}>
          <Skeleton height={14} width="50%" />
          <Skeleton height={12} style={{ marginTop: 16 }} />
          <Skeleton height={12} width="70%" style={{ marginTop: 10 }} />
        </div>
      </div>
    </div>
  );
}
