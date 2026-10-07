"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type Execution, type Objective } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { EmptyState, Flow, Icon, OutcomeTag, PageSkeleton, ProgressBar, RequireAuth, StatusTag, Tag, VerificationTag, useToast } from "@/components";
import { ExportMenu, ReportView } from "@/components/report";
import { ApprovalCard, EventFeed, ExceptionCard, ExecBadge, Section, evidenceToSources } from "@/components/ops";
import { eur, longDate, relativeTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { useObjectiveLive } from "./_components/useObjectiveLive";
import { PlanPanel } from "./_components/Plan";
import { VerificationPanel } from "./_components/Verification";
import { EvidencePanel } from "./_components/Evidence";
import { OutcomePanel } from "./_components/Outcome";

export default function ObjectivePage() {
  return (
    <RequireAuth>
      <ObjectiveConsole />
    </RequireAuth>
  );
}

function flowStep(ex: Execution | null): number {
  if (!ex) return 0;
  switch (ex.status) {
    case "PLANNING":
      return 1;
    case "PLANNED":
    case "WAITING_FOR_APPROVAL":
      return 2;
    case "RUNNING":
    case "BLOCKED":
      return ex.costCents > 0 ? 3 : 2;
    case "VERIFYING":
      return 4;
    default:
      return 5;
  }
}

function ObjectiveConsole() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const { config } = useConfig();
  const { detail, error, reload, stream, partials } = useObjectiveLive(id);
  const [busy, setBusy] = useState<string | null>(null);

  const ex = detail?.execution ?? null;
  const objective = detail?.objective ?? null;

  useEffect(() => {
    if (!objective) return;
    const before = document.title;
    document.title = `${objective.title} · Ensemblis`;
    return () => {
      document.title = before;
    };
  }, [objective]);

  // Balance changes (charge / refund) show up in the header.
  const settledKey = ex ? `${ex.status}:${ex.costCents}:${ex.refundedCents}` : "";
  useEffect(() => {
    if (settledKey) refresh().catch(() => undefined);
  }, [settledKey, refresh]);

  if (!detail) {
    if (error && (error.status === 404 || error.status === 400)) {
      return (
        <div className="narrow" style={{ padding: "56px 0" }}>
          <EmptyState icon="list" title="Objective not found" action={{ label: "Go to Objectives", href: ROUTES.objectives }}>
            It doesn&apos;t exist or belongs to another organization.
          </EmptyState>
        </div>
      );
    }
    return <PageSkeleton />;
  }

  const o = objective!;
  const pendingApproval = ex?.approvals.find((a) => a.status === "PENDING") ?? null;
  const openException = ex?.exceptions.find((x) => x.status === "OPEN") ?? null;
  const terminal = !!ex && ["COMPLETED", "FAILED", "CANCELLED"].includes(ex.status);
  const cancellable = !!ex && !terminal;

  const act = async (what: "cancel" | "again" | "plan") => {
    if (what === "cancel" && !window.confirm("Cancel this execution? Work that hasn't run is refunded.")) return;
    setBusy(what);
    try {
      if (what === "cancel") await api.cancelExecution(ex!.id);
      if (what === "again") await api.runAgain(o.id);
      if (what === "plan") await api.planObjective(o.id);
      toast(what === "cancel" ? "Execution cancelled" : "The Chief of Staff is planning");
      await reload();
      refresh().catch(() => undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 1240 }} data-testid="objective-console">
      <div className="ohead">
        <div className="row wrapflex" style={{ gap: 8 }}>
          <Link href={ROUTES.objectives} className="small muted">
            ← Objectives
          </Link>
          <span className="tiny muted">·</span>
          <span className="eyebrow" style={{ margin: 0 }}>
            OBJECTIVE{ex && ex.attempt > 1 ? ` · ATTEMPT ${ex.attempt}` : ""}
          </span>
        </div>
        <div className="row between wrapflex" style={{ alignItems: "flex-start", marginTop: 8, gap: 16 }}>
          <h1>{o.title}</h1>
          <div className="row wrapflex" style={{ gap: 8 }}>
            {cancellable && (
              <button type="button" className="btn sm" onClick={() => act("cancel")} aria-busy={busy === "cancel"} disabled={!!busy}>
                Cancel execution
              </button>
            )}
            {terminal && (
              <button type="button" className="btn sm" onClick={() => act("again")} aria-busy={busy === "again"} disabled={!!busy}>
                <Icon name="redo" />
                Run again
              </button>
            )}
            {o.status === "DRAFT" && (
              <button type="button" className="btn p sm" onClick={() => act("plan")} aria-busy={busy === "plan"} disabled={!!busy}>
                Send to the Chief of Staff
              </button>
            )}
          </div>
        </div>
        <div className="row wrapflex" style={{ gap: 8, marginTop: 12 }} data-testid="execution-status" data-status={ex?.status ?? o.status} data-verification={ex?.verificationStatus ?? ""}>
          <StatusTag status={ex?.status ?? o.status} />
          {ex?.verificationStatus && <VerificationTag status={ex.verificationStatus} score={ex.verificationScore} />}
          {ex?.outcomeStatus && <OutcomeTag outcome={ex.outcomeStatus} />}
          {config.mockAI && (
            <Tag variant="warn" title="This server runs the mock AI provider: plans and outputs are placeholders for development and testing, not real analysis.">
              Mock AI — test output
            </Tag>
          )}
        </div>
        <div className="meta">
          <span>
            Deadline <b>{o.deadline ? longDate(o.deadline) : "none"}</b>
          </span>
          <span>
            Budget <b>{eur(o.budgetCents)}</b>
          </span>
          {ex && (
            <span>
              {ex.costCents ? "Charged" : "Estimated"} <b>{eur(ex.costCents || ex.estimatedCostCents, { decimals: true })}</b>
              {ex.refundedCents > 0 && <> · refunded {eur(ex.refundedCents, { decimals: true })}</>}
            </span>
          )}
          <span>
            Autonomy <b>{o.autonomy === "REVIEW_PLAN" ? "review the plan first" : "run within budget"}</b>
          </span>
          <span>
            Defined {relativeTime(o.createdAt)}
            {o.createdBy ? ` by ${o.createdBy.name}` : ""}
          </span>
        </div>
        <Flow step={flowStep(ex)} />
      </div>

      {pendingApproval && (
        <div style={{ marginTop: 8 }}>
          <ApprovalCard approval={pendingApproval} onDone={reload} />
        </div>
      )}
      {openException && (
        <div style={{ marginTop: 8 }}>
          <ExceptionCard exception={openException} onDone={reload} />
        </div>
      )}
      {ex?.status === "FAILED" && (
        <div className="attn bad" style={{ marginTop: 8 }}>
          <h3>This execution failed</h3>
          <p className="small">{ex.errorMessage}</p>
          <p className="small muted" style={{ marginTop: 6 }}>
            {ex.refundedCents > 0 ? `${eur(ex.refundedCents, { decimals: true })} was refunded. ` : ""}Completed work and the event log are kept below.
          </p>
        </div>
      )}

      <div className="console" style={{ marginTop: 18 }}>
        <div style={{ minWidth: 0 }}>
          <Section title="Objective">
            <div className="card tight">
              <p className="stmt" style={{ marginTop: 0 }}>
                {o.statement}
              </p>
              {o.contextNotes && (
                <details className="det" style={{ marginTop: 10 }}>
                  <summary className="small">Context for this objective</summary>
                  <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
                    {o.contextNotes}
                  </p>
                </details>
              )}
            </div>
          </Section>

          <SuccessCriteria objective={o} execution={ex} onSaved={reload} />

          {ex && (
            <Section title="Plan & execution" count={`${ex.progress.done}/${ex.progress.total}`}>
              <PlanPanel execution={ex} partials={partials} />
            </Section>
          )}

          {ex && (ex.verification || ex.status === "VERIFYING") && (
            <Section title="Verification" id="verification">
              <VerificationPanel execution={ex} />
            </Section>
          )}

          {ex?.result && (
            <Section
              title="Result"
              id="result"
              right={
                <div className="row" style={{ gap: 8 }}>
                  {ex.status === "COMPLETED" && <ShareButton execution={ex} onChange={reload} />}
                  <ExportMenu title={o.title} markdown={ex.result} sources={evidenceToSources(ex.evidence)} meta={{ date: ex.completedAt, label: "Ensemblis outcome" }} />
                </div>
              }
            >
              {ex.status !== "COMPLETED" && (
                <div className="banner-info" style={{ marginBottom: 12 }}>
                  <Icon name="info" size={15} />
                  <span className="small">Draft result — it becomes final only after it passes verification (or you accept it).</span>
                </div>
              )}
              <ReportView markdown={ex.result} sources={evidenceToSources(ex.evidence)} idPrefix="res" />
            </Section>
          )}

          {ex && (
            <Section title="Evidence" count={ex.evidence.length} id="evidence">
              <EvidencePanel execution={ex} />
            </Section>
          )}

          {ex?.status === "COMPLETED" && (
            <Section title="Outcome" id="outcome">
              <OutcomePanel objective={o} execution={ex} onExecution={reload} />
            </Section>
          )}

          {ex && ex.memories.length > 0 && (
            <Section title="What Ensemblis learned" count={ex.memories.length}>
              <div className="card tight">
                {ex.memories.map((m) => (
                  <div key={m.id} className="row between" style={{ padding: "6px 0", gap: 12 }}>
                    <span className="small">{m.content}</span>
                    <Tag variant={m.status === "ACTIVE" ? "ok" : "warn"}>{m.status === "ACTIVE" ? "Remembered" : "Needs your confirmation"}</Tag>
                  </div>
                ))}
                <Link href={ROUTES.memory} className="tiny" style={{ color: "var(--accent)" }}>
                  Review memory →
                </Link>
              </div>
            </Section>
          )}
        </div>

        <aside className="side">
          {ex && <LiveCard execution={ex} stream={stream} />}
          {ex && (
            <div className="card tight">
              <h2 className="sh">Activity</h2>
              <EventFeed events={ex.events} limit={40} />
            </div>
          )}
          {detail.executions.length > 1 && (
            <div className="card tight">
              <h2 className="sh">Attempts</h2>
              {detail.executions.map((e) => (
                <div key={e.id} className="row between small" style={{ padding: "5px 0" }}>
                  <span>
                    #{e.attempt} · {relativeTime(e.createdAt)}
                  </span>
                  <StatusTag status={e.status} />
                </div>
              ))}
            </div>
          )}
          {!ex && o.status === "DRAFT" && (
            <div className="card tight">
              <b>Draft</b>
              <p className="small muted" style={{ marginTop: 4 }}>
                Nothing has been planned or charged. Send it to the Chief of Staff when you&apos;re ready.
              </p>
              <button type="button" className="btn p sm" style={{ marginTop: 10 }} onClick={() => act("plan")} disabled={!!busy}>
                Plan it
              </button>
            </div>
          )}
          <button type="button" className="btn ghost sm" onClick={() => router.push(ROUTES.newObjective)}>
            <Icon name="plus" />
            Define another outcome
          </button>
        </aside>
      </div>
    </div>
  );
}

function LiveCard({ execution, stream }: { execution: Execution; stream: string }) {
  const working = execution.steps.filter((s) => s.status === "RUNNING");
  const pct = execution.progress.total ? Math.round((execution.progress.done / execution.progress.total) * 100) : 0;
  const waiting = execution.status === "WAITING_FOR_APPROVAL" ? "Waiting for your approval" : execution.status === "BLOCKED" ? "Paused — needs your attention" : null;
  return (
    <div className="card tight" data-testid="live-card">
      <div className="row between">
        <h2 className="sh" style={{ margin: 0 }}>
          Live execution
        </h2>
        {stream === "live" ? (
          <span className="tiny row" style={{ gap: 6 }}>
            <span className="pulse" aria-hidden="true" /> Live
          </span>
        ) : stream === "reconnecting" || stream === "polling" ? (
          <span className="tiny muted">Reconnecting…</span>
        ) : null}
      </div>
      <ProgressBar value={pct} label="Execution progress" style={{ marginTop: 10 }} />
      <div className="tiny muted" style={{ marginTop: 6 }}>
        {execution.progress.done} of {execution.progress.total} steps done
      </div>
      {working.map((s) => (
        <div key={s.id} className="working">
          <ExecBadge executive={s.executive} size={26} />
          <span>
            <b>{s.agent}</b> ({s.executiveTitle}) is working on “{s.title}”
          </span>
        </div>
      ))}
      {execution.status === "PLANNING" && (
        <div className="working">
          <ExecBadge executive="chief_of_staff" size={26} />
          <span>
            <b>Chief of Staff</b> is planning
          </span>
        </div>
      )}
      {execution.status === "VERIFYING" && (
        <div className="working">
          <ExecBadge executive="chief_of_staff" size={26} />
          <span>
            <b>Verification</b> is checking the result
          </span>
        </div>
      )}
      {waiting && <p className="small" style={{ marginTop: 10, color: "var(--warn)" }}>{waiting}</p>}
      {execution.status === "COMPLETED" && <p className="small" style={{ marginTop: 10, color: "var(--ok)" }}>Completed {relativeTime(execution.completedAt)}</p>}
    </div>
  );
}

function SuccessCriteria({ objective, execution, onSaved }: { objective: Objective; execution: Execution | null; onSaved: () => void }) {
  const toast = useToast();
  const editable = ["DRAFT", "WAITING_FOR_APPROVAL", "PLANNED"].includes(objective.status) || (objective.status === "BLOCKED" && !execution?.costCents);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const measurements = useMemo(() => new Map((execution?.measurements ?? []).map((m) => [m.criterionId, m])), [execution]);
  const start = () => {
    setRows(objective.criteria.map((c) => c.description));
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.replaceCriteria(objective.id, rows.filter((r) => r.trim().length >= 3).map((description) => ({ description })));
      setEditing(false);
      toast("Success criteria updated");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section
      title="Success criteria"
      count={objective.criteria.length}
      right={
        editable && !editing ? (
          <button type="button" className="linkbtn small" onClick={start}>
            Edit
          </button>
        ) : null
      }
    >
      {editing ? (
        <div className="card tight">
          {rows.map((r, i) => (
            <div className="row" key={i} style={{ marginBottom: 8 }}>
              <input className="f" value={r} maxLength={300} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? e.target.value : y)))} aria-label={`Criterion ${i + 1}`} />
              <button type="button" className="ibtn" aria-label="Remove criterion" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div className="row wrapflex">
            {rows.length < 6 && (
              <button type="button" className="btn sm" onClick={() => setRows((x) => [...x, ""])}>
                <Icon name="plus" /> Add
              </button>
            )}
            <button type="button" className="btn p sm" onClick={save} aria-busy={saving} disabled={saving || !rows.some((r) => r.trim().length >= 3)}>
              Save
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : objective.criteria.length ? (
        <div className="crit">
          {objective.criteria.map((c, i) => {
            const m = measurements.get(c.id);
            return (
              <div className="row2" key={c.id} data-testid="criterion">
                <span className="n">{i + 1}</span>
                <div>
                  <span className="small" style={{ fontWeight: 600 }}>
                    {c.description}
                  </span>
                  {c.source === "proposed" && <span className="src">proposed by the Chief of Staff</span>}
                  {c.targetValue != null && (
                    <div className="tiny muted">
                      Target: {c.targetValue} {c.unit}
                    </div>
                  )}
                </div>
                {m ? <span className="tiny muted">{m.result.replace(/_/g, " ").toLowerCase()}</span> : <span />}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="small muted">The Chief of Staff proposes success criteria while planning.</p>
      )}
    </Section>
  );
}

function ShareButton({ execution, onChange }: { execution: Execution; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const url = execution.shareToken && typeof window !== "undefined" ? `${window.location.origin}${ROUTES.sharedReport(execution.shareToken)}` : null;
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await api.shareExecution(execution.id, !execution.shareToken);
      if (r.shareToken) {
        const link = `${window.location.origin}${ROUTES.sharedReport(r.shareToken)}`;
        await navigator.clipboard?.writeText(link).catch(() => undefined);
        toast("Public link created and copied");
      } else toast("Public link turned off");
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row" style={{ gap: 6 }}>
      {url && (
        <a className="btn sm" href={url} target="_blank" rel="noopener noreferrer" data-testid="share-link">
          <Icon name="ext" /> Public page
        </a>
      )}
      <button type="button" className="btn sm" onClick={toggle} aria-busy={busy} disabled={busy}>
        <Icon name="share" />
        {execution.shareToken ? "Stop sharing" : "Share"}
      </button>
    </div>
  );
}
