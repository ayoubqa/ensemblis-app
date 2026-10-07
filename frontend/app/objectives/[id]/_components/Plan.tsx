"use client";

import { useState } from "react";
import type { Execution, ExecutionStep } from "@/lib/api";
import { Icon, StepStatusTag, Tag } from "@/components";
import { ReportMarkdown } from "@/components/report";
import { ExecBadge, evidenceToSources } from "@/components/ops";
import { duration, eur, relativeTime } from "@/lib/format";

function StepCard({ step, execution, partial }: { step: ExecutionStep; execution: Execution; partial?: string }) {
  const [open, setOpen] = useState(false);
  const live = step.status === "RUNNING";
  const text = live ? partial ?? step.partialOutput : null;
  const secs = step.startedAt && step.completedAt ? Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000) : null;
  return (
    <li className={`st-${step.status}`} data-testid="plan-step" data-status={step.status}>
      <div className="tl-dot" aria-hidden="true">
        {step.status === "COMPLETED" ? <Icon name="check" /> : step.status === "FAILED" ? <Icon name="x" /> : step.order + 1}
      </div>
      <div className="tl-card">
        <div className="tl-top">
          <div style={{ minWidth: 0 }}>
            <div className="tl-title">
              {step.title}
              {step.kind === "revision" && (
                <Tag variant="warn" className="ml-2">
                  Revision
                </Tag>
              )}
            </div>
            <div className="tl-who">
              <b>{step.executiveTitle}</b> → {step.agent} · {step.capabilityName} <span className="mono">v{step.capabilityVersion}</span>
            </div>
          </div>
          <StepStatusTag status={step.status} />
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          {step.purpose}
        </p>
        {step.summary && step.status === "COMPLETED" && <p className="tl-sum">{step.summary}</p>}
        {live && (
          <div className="livebox" aria-live="polite" aria-label={`${step.agent} is writing`}>
            {text ? text.slice(-2500) : `${step.agent} is gathering evidence…`}
          </div>
        )}
        {step.status === "FAILED" && step.error && (
          <p className="small" style={{ color: "var(--bad)", marginTop: 8 }}>
            {step.error}
          </p>
        )}
        {step.status === "PENDING" && step.retryAt && <p className="tiny muted" style={{ marginTop: 6 }}>Retry scheduled {relativeTime(step.retryAt)}.</p>}
        <div className="tl-meta">
          {step.evidenceNs.length > 0 && (
            <span>
              <Icon name="link" size={12} /> Evidence {step.evidenceNs.map((n) => `[${n}]`).join(" ")}
            </span>
          )}
          {step.attempts > 1 && <span>{step.attempts} attempts</span>}
          {secs !== null && <span>{duration(secs)}</span>}
          {step.tokensIn + step.tokensOut > 0 && <span>{(step.tokensIn + step.tokensOut).toLocaleString()} tokens</span>}
          {step.costCents > 0 && <span>{eur(step.costCents, { decimals: true })}</span>}
          {step.output && (
            <button type="button" className="linkbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? "Hide work" : "Show work"}
            </button>
          )}
        </div>
        {open && step.output && (
          <div className="prose max-w-none" style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <ReportMarkdown sources={evidenceToSources(execution.evidence)}>{step.output}</ReportMarkdown>
          </div>
        )}
      </div>
    </li>
  );
}

export function PlanPanel({ execution, partials }: { execution: Execution; partials: Record<string, string> }) {
  const plan = execution.plan;
  if (!plan && execution.status === "PLANNING") {
    return (
      <div className="card tight row" style={{ gap: 12 }}>
        <ExecBadge executive="chief_of_staff" />
        <div>
          <b>The Chief of Staff is planning</b>
          <div className="small muted">Reading your company context and memory, choosing capabilities and pricing the plan.</div>
        </div>
        <span className="spin" aria-hidden="true" style={{ marginLeft: "auto" }} />
      </div>
    );
  }
  return (
    <div>
      {plan && (
        <div className="card tight" style={{ marginBottom: 14 }}>
          <div className="row between wrapflex" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10 }}>
              <ExecBadge executive="chief_of_staff" />
              <div>
                <b>Chief of Staff&apos;s plan</b>
                <div className="tiny muted">
                  {execution.steps.filter((s) => s.kind === "work").length} steps · estimated {eur(plan.estimatedCostCents, { decimals: true })}
                  {plan.estimatedManualHours ? ` · ≈${plan.estimatedManualHours}h of analyst time (planner estimate)` : ""}
                </div>
              </div>
            </div>
            {plan.source === "fallback" ? (
              <Tag variant="warn" title={plan.notes.join(" ")}>
                Standard playbook
              </Tag>
            ) : (
              <Tag variant="gray">{plan.version}</Tag>
            )}
          </div>
          {plan.objective && <p className="small" style={{ marginTop: 10 }}>{plan.objective}</p>}
          {plan.assumptions.length > 0 && (
            <details className="det" style={{ marginTop: 10 }}>
              <summary className="small">Assumptions ({plan.assumptions.length})</summary>
              <ul className="small" style={{ paddingLeft: 18, marginTop: 6 }}>
                {plan.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          {plan.risks.length > 0 && (
            <details className="det" style={{ marginTop: 6 }}>
              <summary className="small">Risks ({plan.risks.length})</summary>
              <ul className="small" style={{ paddingLeft: 18, marginTop: 6 }}>
                {plan.risks.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          {plan.notes.length > 0 && <p className="tiny muted" style={{ marginTop: 8 }}>{plan.notes.join(" ")}</p>}
        </div>
      )}
      <ol className="timeline" aria-label="Plan steps">
        {execution.steps.map((s) => (
          <StepCard key={s.id} step={s} execution={execution} partial={partials[s.id]} />
        ))}
        <li className={execution.verification ? (execution.verification.status === "FAIL" ? "st-FAILED" : "st-COMPLETED") : execution.status === "VERIFYING" ? "st-RUNNING" : "st-PENDING"}>
          <div className="tl-dot" aria-hidden="true">
            <Icon name="shield" />
          </div>
          <div className="tl-card">
            <div className="tl-top">
              <div>
                <div className="tl-title">Verification gate</div>
                <div className="tl-who">
                  <b>Chief of Staff</b> → evidence, success criteria, completeness, consistency
                </div>
              </div>
              {execution.status === "VERIFYING" ? <StepStatusTag status="RUNNING" /> : execution.verification ? <StepStatusTag status={execution.verification.status === "FAIL" ? "FAILED" : "COMPLETED"} /> : <StepStatusTag status="PENDING" />}
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}
