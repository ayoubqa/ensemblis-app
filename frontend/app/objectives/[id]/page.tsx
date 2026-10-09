"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Approval, type Execution, type MemoryItem, type Objective } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { EmptyState, Icon, OutcomeTag, PageSkeleton, RequireAuth, StatusTag, Tag, VerificationTag, useToast } from "@/components";
import { ExportMenu, ReportView, copyText } from "@/components/report";
import { ApprovalCard, EventFeed, ExceptionCard, evidenceToSources } from "@/components/ops";
import { eur, longDate, relativeTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { useObjectiveLive } from "./_components/useObjectiveLive";
import { ExecutionTimeline, PlanSummary } from "./_components/Plan";
import { VerificationPanel } from "./_components/Verification";
import { EvidencePanel, evidenceId } from "./_components/Evidence";
import { OutcomePanel } from "./_components/Outcome";
import { LifecycleStepper, lifecycle, type StageKey } from "./_components/Lifecycle";
import { Stage } from "./_components/Stage";
import { NowCard } from "./_components/Now";

export default function ObjectivePage() {
  return (
    <RequireAuth>
      <ObjectiveConsole />
    </RequireAuth>
  );
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
  const evidence = ex?.evidence;
  const sources = useMemo(() => evidenceToSources(evidence ?? []), [evidence]);

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
    if (error && (error.status === 404 || error.status === 400 || error.status === 403)) {
      return (
        <div className="narrow" style={{ paddingBlock: 56 }}>
          <EmptyState icon="list" title="Objective not found" titleAs="h1" action={{ label: "Go to Objectives", href: ROUTES.objectives }}>
            It doesn&apos;t exist or belongs to another organization.
          </EmptyState>
        </div>
      );
    }
    if (error) {
      return (
        <div className="narrow" style={{ paddingBlock: 56 }}>
          <EmptyState
            icon="alert"
            titleAs="h1"
            title="Couldn't load this objective"
            action={
              <button type="button" className="btn p" onClick={() => void reload()}>
                Try again
              </button>
            }
          >
            {error.message || "Something went wrong."} We&apos;ll keep retrying in the background.
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
  // While an open exception offers "Cancel execution" itself, keep a single button with that name.
  const cancellable = !!ex && !terminal && !openException?.actions.includes("cancel");
  const stages = lifecycle(o, ex, openException);
  const st = Object.fromEntries(stages.map((s) => [s.key, s])) as Record<StageKey, (typeof stages)[number]>;
  const present = new Set<StageKey>(ex ? ["objective", "plan", "approval", "execution", "verification", "evidence", "outcome"] : ["objective", "plan"]);
  const verified = ex?.status === "COMPLETED" && (ex.verificationStatus === "PASS" || ex.verificationStatus === "PASS_WITH_WARNINGS");

  const act = async (what: "cancel" | "again" | "plan") => {
    if (what === "cancel" && !window.confirm("Cancel this execution? Work that hasn't been executed is refunded.")) return;
    setBusy(what);
    try {
      if (what === "cancel") await api.cancelExecution(ex!.id);
      if (what === "again") await api.runAgain(o.id);
      if (what === "plan") await api.planObjective(o.id);
      toast(what === "cancel" ? "Execution cancelled" : what === "again" ? "The Chief of Staff is planning a new attempt" : "The Chief of Staff is planning");
      await reload();
      refresh().catch(() => undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wrap cs" data-testid="objective-console">
      {/* ---------------------------------------------------------------- header */}
      <div className="ohead cs-head">
        <div className="cs-crumbs">
          <Link href={ROUTES.objectives}>
            <Icon name="back" size={14} />
            Objectives
          </Link>
          <span aria-hidden="true">/</span>
          <span className="cs-crumb-here">
            Objective{ex && ex.attempt > 1 ? ` · attempt ${ex.attempt}` : ""}
          </span>
        </div>
        <div className="cs-head-row">
          <div className="cs-head-main">
            <h1>{o.title}</h1>
            <div className="cs-status" data-testid="execution-status" data-status={ex?.status ?? o.status} data-verification={ex?.verificationStatus ?? ""}>
              <StatusTag status={ex?.status ?? o.status} />
              {ex?.verificationStatus && <VerificationTag status={ex.verificationStatus} score={ex.verificationScore} />}
              {ex?.outcomeStatus && <OutcomeTag outcome={ex.outcomeStatus} />}
              {config.mockAI && <Tag variant="warn">Mock AI — test output</Tag>}
            </div>
          </div>
          <div className="cs-actions">
            {ex?.status === "COMPLETED" && <ShareControls execution={ex} onChange={reload} />}
            {cancellable && (
              <button type="button" className="btn sm" onClick={() => act("cancel")} aria-busy={busy === "cancel"} disabled={!!busy}>
                <Icon name="x" />
                Cancel execution
              </button>
            )}
            {terminal && (
              <button type="button" className="btn sm" onClick={() => act("again")} aria-busy={busy === "again"} disabled={!!busy}>
                <Icon name="redo" />
                New attempt
              </button>
            )}
            {o.status === "DRAFT" && (
              <button type="button" className="btn p sm" onClick={() => act("plan")} aria-busy={busy === "plan"} disabled={!!busy}>
                <Icon name="compass" />
                Send to the Chief of Staff
              </button>
            )}
          </div>
        </div>
        {config.mockAI && <p className="cs-mock">Mock AI: this server uses the mock AI provider, so plans and outputs are placeholders for development and testing, not real analysis.</p>}
        <dl className="cs-facts">
          <div>
            <dt>Budget</dt>
            <dd>{eur(o.budgetCents)}</dd>
          </div>
          {ex && (
            <div>
              {ex.costCents ? (
                <>
                  <dt>Charged</dt>
                  <dd>
                    {eur(ex.costCents, { decimals: true })}
                    {ex.refundedCents > 0 && <small>{eur(ex.refundedCents, { decimals: true })} refunded</small>}
                  </dd>
                </>
              ) : (
                <>
                  <dt>Estimate</dt>
                  <dd>
                    {eur(ex.estimatedCostCents, { decimals: true })}
                    <small>Chief of Staff estimate</small>
                  </dd>
                </>
              )}
            </div>
          )}
          <div>
            <dt>Deadline</dt>
            <dd>{o.deadline ? longDate(o.deadline) : "None set"}</dd>
          </div>
          <div>
            <dt>Autonomy</dt>
            <dd>{o.autonomy === "REVIEW_PLAN" ? "Review the plan first" : "Proceed within budget"}</dd>
          </div>
          <div>
            <dt>Defined</dt>
            <dd>
              {relativeTime(o.createdAt)}
              {o.createdBy && <small>by {o.createdBy.name}</small>}
            </dd>
          </div>
        </dl>
      </div>

      <LifecycleStepper stages={stages} present={present} />

      {/* ---------------------------------------------------------------- needs you */}
      {(pendingApproval || openException) && (
        <section className="cs-attn" id="cs-attention" aria-labelledby="cs-attn-h">
          <h2 id="cs-attn-h" className="cs-attn-h">
            <span className="cs-attn-dot" aria-hidden="true" />
            Needs your decision
          </h2>
          <div className="cs-attn-list">
            {pendingApproval && <ApprovalCard approval={pendingApproval} onDone={reload} />}
            {openException && <ExceptionCard exception={openException} onDone={reload} />}
          </div>
        </section>
      )}
      {ex?.status === "FAILED" && (
        <div className="cs-alert" role="status">
          <Icon name="alert" size={18} />
          <div>
            <h2>This execution failed</h2>
            {ex.errorMessage && <p>{ex.errorMessage}</p>}
            <p className="cs-alert-sub">
              {ex.refundedCents > 0 ? `${eur(ex.refundedCents, { decimals: true })} was refunded. ` : ""}Completed work and the event log are kept below.
            </p>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- story */}
      <div className="cs-grid">
        <div className="cs-main">
          <Stage id="cs-objective" n={1} state={st.objective.state} title="Objective" meta={o.createdBy ? `Defined by ${o.createdBy.name}` : undefined}>
            <div className="cs-card cs-obj">
              <p className="cs-stmt">{o.statement}</p>
              {o.contextNotes && (
                <details className="cs-disc">
                  <summary>Context for this objective</summary>
                  <p className="cs-ctx">{o.contextNotes}</p>
                </details>
              )}
              <SuccessCriteria objective={o} execution={ex} onSaved={reload} />
            </div>
          </Stage>

          <Stage id="cs-plan" n={2} state={st.plan.state} title="Plan" meta={st.plan.note || undefined}>
            {ex ? (
              <PlanSummary execution={ex} />
            ) : (
              <div className="cs-empty">
                <Icon name="compass" size={16} />
                <p>Not planned yet. The Chief of Staff turns the objective into steps, assigns the AI Team and prices the work before anything is charged.</p>
              </div>
            )}
          </Stage>

          {ex && (
            <Stage id="cs-approval" n={3} state={st.approval.state} title="Approval" meta={st.approval.note || undefined}>
              <ApprovalRecord objective={o} execution={ex} pending={pendingApproval} blocked={!!openException} />
            </Stage>
          )}

          {ex && (
            <Stage id="cs-execution" n={4} state={st.execution.state} title="Execution" meta={st.execution.note || undefined}>
              <ExecutionTimeline execution={ex} partials={partials} />
            </Stage>
          )}

          {ex && (
            <Stage id="verification" n={5} state={st.verification.state} title="Verification" meta={st.verification.note || undefined}>
              <VerificationPanel execution={ex} />
            </Stage>
          )}

          {ex?.result && (
            <Stage
              id="result"
              icon="report"
              title="Report"
              meta={ex.status === "COMPLETED" ? (verified ? "Verified deliverable" : "Deliverable") : "Draft"}
              right={
                <ExportMenu
                  title={o.title}
                  markdown={ex.result}
                  sources={sources}
                  meta={{
                    date: ex.completedAt,
                    label: ex.status === "COMPLETED" ? "Ensemblis report" : "Draft — not yet verified",
                  }}
                />
              }
            >
              {ex.status !== "COMPLETED" && (
                <div className="cs-draft">
                  <Icon name="info" size={15} />
                  <span>Draft result — it becomes final only after it passes verification (or you accept it).</span>
                </div>
              )}
              <div className="cs-report">
                <ReportView
                  markdown={ex.result}
                  sources={sources}
                  idPrefix="res"
                  sourcesPanel={false}
                  sourceTargetId={evidenceId}
                  tocExtra={sources.length ? [{ id: "evidence", label: "Evidence", count: sources.length }] : []}
                />
              </div>
            </Stage>
          )}

          {ex && (
            <Stage id="evidence" n={6} state={st.evidence.state} title="Evidence" meta={ex.evidence.length ? `${ex.evidence.length} numbered, cited as [n]` : undefined}>
              <EvidencePanel execution={ex} />
            </Stage>
          )}

          {ex && (
            <Stage id="outcome" n={7} state={st.outcome.state} title="Outcome" meta={st.outcome.note || undefined}>
              {ex.status === "COMPLETED" ? (
                <OutcomePanel objective={o} execution={ex} onExecution={reload} />
              ) : (
                <div className="cs-empty">
                  <Icon name="target" size={16} />
                  <p>
                    {ex.status === "FAILED" || ex.status === "CANCELLED"
                      ? "This attempt ended before the outcome could be measured."
                      : "Measured against your success criteria once the result passes verification."}
                  </p>
                </div>
              )}
            </Stage>
          )}

          {ex && ex.memories.length > 0 && (
            <Stage id="cs-memory" icon="layers" title="Memory" meta="What Ensemblis learned">
              <MemoryList items={ex.memories} />
            </Stage>
          )}
        </div>

        <div className="cs-side">
          <NowCard objective={o} execution={ex} stream={stream} openException={openException} />
          {ex && (
            <section className="cs-panel cs-activity" aria-labelledby="cs-act-h">
              <div className="cs-panel-h">
                <h2 id="cs-act-h">Activity</h2>
                <span>{ex.events.length}</span>
              </div>
              <EventFeed events={ex.events} limit={12} />
            </section>
          )}
          {detail.executions.length > 1 && (
            <section className="cs-panel" aria-labelledby="cs-att-h">
              <div className="cs-panel-h">
                <h2 id="cs-att-h">Attempts</h2>
                <span>{detail.executions.length}</span>
              </div>
              <ol className="cs-attempts">
                {detail.executions.map((e) => (
                  <li key={e.id} className={e.id === ex?.id ? "is-on" : undefined}>
                    <span className="cs-attempt-n">#{e.attempt}</span>
                    <span className="cs-attempt-t">
                      {relativeTime(e.createdAt)}
                      {e.id === ex?.id && <span className="sr-only"> (shown)</span>}
                    </span>
                    <StatusTag status={e.status} />
                  </li>
                ))}
              </ol>
            </section>
          )}
          <button type="button" className="btn ghost sm cs-another" onClick={() => router.push(ROUTES.newObjective)}>
            <Icon name="plus" />
            Define another outcome
          </button>
        </div>
      </div>
    </div>
  );
}

const APPROVAL_KIND: Record<Approval["kind"], string> = { PLAN: "Plan review", BUDGET: "Budget", ACTION: "External action" };

/** The approval stage: a record of each decision, or why none was needed. */
function ApprovalRecord({ objective, execution, pending, blocked }: { objective: Objective; execution: Execution; pending: Approval | null; blocked: boolean }) {
  const decided = execution.approvals.filter((a) => a.status !== "PENDING");
  // Paused by an exception before anything was charged: the approval waits for it.
  const onHold = blocked && execution.status === "BLOCKED" && !execution.costCents;
  return (
    <>
      {pending && (
        <div className="cs-empty is-warn">
          <Icon name="alert" size={16} />
          <p>
            Waiting for your decision. The approval above has the plan, its cost and the recommendation.{" "}
            <a href="#cs-attention" className="cs-inline-link">
              Review it
            </a>
          </p>
        </div>
      )}
      {decided.length > 0 && (
        <ul className="cs-card cs-appr">
          {decided.map((a) => (
            <li key={a.id} className={`s-${a.status}`}>
              <span className="cs-appr-ic" aria-hidden="true">
                <Icon name={a.status === "APPROVED" ? "check" : "x"} size={14} />
              </span>
              <div className="cs-appr-b">
                <p className="cs-appr-t">
                  <b>
                    {APPROVAL_KIND[a.kind]} {a.status === "APPROVED" ? "approved" : a.status === "REJECTED" ? "rejected" : "withdrawn"}
                  </b>{" "}
                  <span>· {relativeTime(a.decidedAt)}</span>
                </p>
                <p className="cs-appr-s">{a.title}</p>
                {a.decisionNote && <p className="cs-appr-note">“{a.decisionNote}”</p>}
              </div>
              <span className="cs-appr-amt">{eur(a.costCents, { decimals: true })}</span>
            </li>
          ))}
        </ul>
      )}
      {!pending && decided.length === 0 && onHold && (
        <div className="cs-empty is-warn">
          <Icon name="alert" size={16} />
          <p>
            On hold: an exception needs your answer before this plan can go forward for approval.{" "}
            <a href="#cs-attention" className="cs-inline-link">
              Resolve it
            </a>
          </p>
        </div>
      )}
      {!pending && decided.length === 0 && !onHold && (
        <div className="cs-empty">
          <Icon name="check" size={16} />
          <p>
            {["PLANNING", "PLANNED"].includes(execution.status) || (execution.status === "BLOCKED" && !execution.costCents)
              ? "The plan and its cost are reviewed here before the AI Team starts."
              : objective.autonomy === "AUTO_WITHIN_BUDGET"
                ? `No approval was required: this objective may proceed within its ${eur(objective.budgetCents)} budget.`
                : "No approval is recorded for this attempt."}
          </p>
        </div>
      )}
    </>
  );
}

const MEMORY_STATUS: Record<MemoryItem["status"], { label: string; variant: "ok" | "warn" | "gray" }> = {
  ACTIVE: { label: "Remembered", variant: "ok" },
  PENDING_CONFIRMATION: { label: "Needs your confirmation", variant: "warn" },
  ARCHIVED: { label: "Archived", variant: "gray" },
};

function MemoryList({ items }: { items: MemoryItem[] }) {
  return (
    <div className="cs-card cs-mem">
      <ul>
        {items.map((m) => (
          <li key={m.id}>
            <span className="cs-mem-ic" aria-hidden="true">
              <Icon name="layers" size={14} />
            </span>
            <p>{m.content}</p>
            <Tag variant={MEMORY_STATUS[m.status].variant}>{MEMORY_STATUS[m.status].label}</Tag>
          </li>
        ))}
      </ul>
      <Link href={ROUTES.memory} className="cs-inline-link cs-mem-link">
        Review memory in Company Context
        <Icon name="arrow" size={13} />
      </Link>
    </div>
  );
}

function SuccessCriteria({ objective, execution, onSaved }: { objective: Objective; execution: Execution | null; onSaved: () => void }) {
  const toast = useToast();
  const editable = ["DRAFT", "WAITING_FOR_APPROVAL", "PLANNED"].includes(objective.status) || (objective.status === "BLOCKED" && !execution?.costCents);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const start = () => {
    setRows(objective.criteria.map((c) => c.description));
    setEditing(true);
  };
  const tooShort = rows.some((r) => r.trim().length > 0 && r.trim().length < 3);
  const save = async () => {
    setSaving(true);
    try {
      await api.replaceCriteria(
        objective.id,
        rows.filter((r) => r.trim().length >= 3).map((description) => ({ description }))
      );
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
    <div className="cs-sc">
      <div className="cs-sc-h">
        <h3>
          Success criteria <span className="cs-count">{objective.criteria.length}</span>
        </h3>
        {editable && !editing && (
          <button type="button" className="cs-linkbtn" onClick={start}>
            <Icon name="edit" size={13} />
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="cs-sc-edit">
          {rows.map((r, i) => (
            <div className="cs-sc-row" key={i}>
              <label className="cs-sc-n" htmlFor={`crit-${i}`}>
                <span className="sr-only">Criterion </span>
                {i + 1}
              </label>
              <input id={`crit-${i}`} className="f" value={r} maxLength={300} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
              <button type="button" className="ibtn" aria-label={`Remove criterion ${i + 1}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          {tooShort && <p className="cs-sc-warn">Each criterion needs at least 3 characters.</p>}
          <div className="cs-sc-btns">
            {rows.length < 6 && (
              <button type="button" className="btn sm" onClick={() => setRows((x) => [...x, ""])}>
                <Icon name="plus" /> Add
              </button>
            )}
            <button type="button" className="btn p sm" onClick={save} aria-busy={saving} disabled={saving || tooShort || !rows.some((r) => r.trim().length >= 3)}>
              Save
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : objective.criteria.length ? (
        <ol className="cs-sc-list">
          {objective.criteria.map((c, i) => (
            <li key={c.id} data-testid="criterion">
              <span className="cs-sc-n" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p>{c.description}</p>
                {(c.targetValue != null || c.source === "proposed") && (
                  <p className="cs-sc-meta">
                    {c.targetValue != null && (
                      <span>
                        Target: {c.targetValue} {c.unit}
                      </span>
                    )}
                    {c.source === "proposed" && <span>Proposed by the Chief of Staff</span>}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="cs-sc-none">The Chief of Staff proposes success criteria while planning.</p>
      )}
    </div>
  );
}

function ShareControls({ execution, onChange }: { execution: Execution; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const url = execution.shareToken && typeof window !== "undefined" ? `${window.location.origin}${ROUTES.sharedReport(execution.shareToken)}` : null;
  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.shareExecution(execution.id, !execution.shareToken);
      if (r.shareToken) {
        const ok = await copyText(`${window.location.origin}${ROUTES.sharedReport(r.shareToken)}`);
        toast(ok ? "Public link created and copied" : "Public link created — open Public page to copy it");
      } else toast("Public link turned off");
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [execution.id, execution.shareToken, onChange, toast]);
  return (
    <>
      {url && (
        <a className="btn sm" href={url} target="_blank" rel="noopener noreferrer" data-testid="share-link">
          <Icon name="ext" /> Public page
        </a>
      )}
      <button type="button" className={execution.shareToken ? "btn sm" : "btn p sm"} onClick={toggle} aria-busy={busy} disabled={busy}>
        <Icon name="share" />
        {execution.shareToken ? "Stop sharing" : "Share"}
      </button>
    </>
  );
}
