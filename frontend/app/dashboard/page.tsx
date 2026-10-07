"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api, type Briefing } from "@/lib/api";
import { EmptyState, Icon, OutcomeTag, PageSkeleton, RequireAuth, VerificationTag } from "@/components";
import { ApprovalCard, EventFeed, ExceptionCard, ExecBadge } from "@/components/ops";
import { eur, greeting, plural, relativeTime } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import { LOOP } from "@/lib/data";
import { ROUTES } from "@/lib/routes";

export default function DashboardPage() {
  return (
    <RequireAuth>
      <ChiefOfStaffBriefing />
    </RequireAuth>
  );
}

function ChiefOfStaffBriefing() {
  const [b, setB] = useState<Briefing | null>(null);
  const load = useCallback(async () => {
    setB(await api.briefing());
  }, []);
  // A briefing, not a ticker: refresh every 30s while visible.
  usePolling(load, 30_000);

  if (!b) return <PageSkeleton cards={4} />;
  const attention = b.attention.approvals.length + b.attention.exceptions.length;
  const fresh = b.objectives.total === 0;

  return (
    <div className="wrap" style={{ paddingBottom: 48 }} data-testid="briefing">
      <div className="pagehead">
        <div className="eyebrow">CHIEF OF STAFF BRIEFING · {b.orgName.toUpperCase()}</div>
        <h1>
          {greeting()}, {b.greetingName}.
        </h1>
        <p>
          {fresh
            ? "Your AI Team is ready. Describe a business outcome and the Chief of Staff will plan it, assign the work and bring you a verified result."
            : attention
              ? `${attention} item${attention === 1 ? " needs" : "s need"} your attention. ${b.objectives.running ? `${b.objectives.running} objective${b.objectives.running === 1 ? " is" : "s are"} in progress.` : ""}`
              : b.objectives.running
                ? `${b.objectives.running} objective${b.objectives.running === 1 ? " is" : "s are"} in progress. Nothing needs you right now.`
                : "Nothing needs you right now."}
        </p>
      </div>

      <div className="kpis">
        <Link href={`${ROUTES.objectives}?group=active`} className="kpi">
          <b>{b.objectives.active}</b>
          <span>Active objectives</span>
          <em>{b.objectives.running} running · {b.objectives.waiting} awaiting approval</em>
        </Link>
        <Link href={`${ROUTES.objectives}?group=attention`} className={attention ? "kpi hot" : "kpi"}>
          <b>{attention}</b>
          <span>Need your attention</span>
          <em>
            {b.attention.approvals.length} approvals · {b.attention.exceptions.length} exceptions
          </em>
        </Link>
        <Link href={`${ROUTES.objectives}?group=completed`} className="kpi">
          <b>{b.objectives.completed}</b>
          <span>Outcomes delivered</span>
          <em>{plural(b.value30d.criteriaMet, "success criterion", "success criteria")} met in 30 days</em>
        </Link>
        <Link href={ROUTES.usage} className="kpi">
          <b>{eur(b.usage.monthSpendCents)}</b>
          <span>Execution spend this month</span>
          <em>
            {plural(b.usage.executionsThisMonth, "execution")} · {eur(b.usage.balanceCents)} balance
          </em>
        </Link>
      </div>

      {fresh && (
        <div className="section">
          <h2 className="sh">How your AI organization works</h2>
          <div className="loopbar">
            {LOOP.map((s, i) => (
              <div className="lp" key={s.key}>
                <span className="k">
                  {i + 1}. {s.title}
                </span>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
          <div className="row wrapflex" style={{ marginTop: 16 }}>
            <Link href={ROUTES.newObjective} className="btn p lg">
              <Icon name="plus" />
              Define your first outcome
            </Link>
            {b.context.filled < b.context.total && (
              <Link href={ROUTES.context} className="btn lg">
                Tell Ensemblis about your business ({b.context.filled}/{b.context.total})
              </Link>
            )}
          </div>
        </div>
      )}

      {attention > 0 && (
        <div className="section">
          <h2 className="sh">
            Needs your attention<span className="ct">{attention}</span>
          </h2>
          <div className="stack">
            {b.attention.approvals.map((a) => (
              <ApprovalCard key={a.id} approval={a} onDone={load} showObjective />
            ))}
            {b.attention.exceptions.map((x) => (
              <ExceptionCard key={x.id} exception={x} onDone={load} showObjective />
            ))}
          </div>
        </div>
      )}

      {!fresh && (
        <div className="console" style={{ marginTop: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div className="section">
              <h2 className="sh">AI Team — working now</h2>
              {b.team.working.length ? (
                <div className="card tight">
                  {b.team.working.map((w, i) => (
                    <Link key={i} href={ROUTES.objective(w.objectiveId)} className="working" style={{ padding: "6px 0" }}>
                      <ExecBadge executive={w.executive} size={28} />
                      <span>
                        <b>{w.agent}</b> <span className="muted">({w.executiveTitle})</span> — {w.stepTitle}
                        <span className="tiny muted"> · {w.objectiveTitle}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="small muted">No one is working right now.</p>
              )}
            </div>

            <div className="section">
              <h2 className="sh">Recent outcomes</h2>
              {b.recentOutcomes.length ? (
                <div className="olist">
                  {b.recentOutcomes.map((r) => (
                    <Link key={r.executionId} href={ROUTES.objective(r.objectiveId)} className="orow" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="t">{r.objectiveTitle}</div>
                        <div className="s">
                          {r.outcomeSummary} · {eur(r.costCents, { decimals: true })} · {relativeTime(r.completedAt)}
                        </div>
                      </div>
                      <OutcomeTag outcome={r.outcomeStatus} />
                      <span className="hideM">
                        <VerificationTag status={r.verificationStatus} score={r.verificationScore} />
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon="flag" title="No completed outcomes yet">
                  Completed objectives appear here with their verification and outcome.
                </EmptyState>
              )}
            </div>
          </div>
          <aside className="side">
            <div className="card tight">
              <h2 className="sh">Latest activity</h2>
              <EventFeed events={b.team.activity} limit={12} linkObjectives />
            </div>
            <div className="card tight">
              <h2 className="sh">Your business</h2>
              <p className="small">
                Company Context: <b>{b.context.filled}/{b.context.total}</b> sections
              </p>
              {b.context.missing.length > 0 && <p className="tiny muted">Missing: {b.context.missing.join(", ")}</p>}
              <Link href={ROUTES.context} className="tiny" style={{ color: "var(--accent)" }}>
                Open Company Context →
              </Link>
              {b.value30d.estimatedHoursReturned > 0 && (
                <p className="tiny muted" style={{ marginTop: 10 }}>
                  ≈{b.value30d.estimatedHoursReturned}h of analyst work in 30 days — the Chief of Staff&apos;s planning estimates, not measured time.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
