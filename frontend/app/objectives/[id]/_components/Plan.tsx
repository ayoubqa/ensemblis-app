"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Execution, ExecutionStep, TaskSource } from "@/lib/api";
import { Icon, StepStatusTag, Tag } from "@/components";
import { CiteProvider, ReportMarkdown } from "@/components/report";
import { ExecBadge, evidenceToSources } from "@/components/ops";
import { duration, eur, relativeTime } from "@/lib/format";
import { EvidenceChips, evidenceId, focusEvidence } from "./Evidence";

/** The Chief of Staff at work before a plan exists. */
function Planning() {
  return (
    <div className="cs-card cs-planning">
      <ExecBadge executive="chief_of_staff" size={36} />
      <div>
        <p className="cs-planning-t">The Chief of Staff is planning</p>
        <p className="cs-planning-s">Reading your company context and memory, choosing capabilities and pricing the plan.</p>
      </div>
      <span className="cs-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

/** The Chief of Staff's plan: deliverable, team, estimate, assumptions and risks. */
export function PlanSummary({ execution }: { execution: Execution }) {
  const plan = execution.plan;
  if (!plan) {
    if (execution.status === "PLANNING") return <Planning />;
    return (
      <div className="cs-empty">
        <Icon name="list" size={16} />
        <p>No plan was made for this attempt.</p>
      </div>
    );
  }
  const work = execution.steps.filter((s) => s.kind === "work");
  const execs = Array.from(new Set(work.map((s) => s.executiveTitle)));
  const missing = plan.missingInformation ?? [];
  return (
    <div className="cs-card cs-plan">
      <div className="cs-plan-top">
        <ExecBadge executive="chief_of_staff" size={36} />
        <div className="cs-plan-tt">
          <span className="cs-kicker">Chief of Staff&apos;s plan</span>
          <h3>{plan.title || "Plan"}</h3>
        </div>
        {plan.source === "fallback" && <Tag variant="warn">Standard playbook</Tag>}
      </div>
      {plan.objective && (
        <p className="cs-plan-deliv">
          <span>Deliverable</span>
          {plan.objective}
        </p>
      )}
      <dl className="cs-plan-facts">
        <div>
          <dt>Steps</dt>
          <dd>{work.length}</dd>
        </div>
        <div>
          <dt>Executives</dt>
          <dd>{execs.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt>Estimated cost</dt>
          <dd>
            {eur(plan.estimatedCostCents, { decimals: true })} <small>estimate</small>
          </dd>
        </div>
      </dl>
      {plan.notes.length > 0 && <p className="cs-plan-notes">{plan.notes.join(" ")}</p>}
      {(plan.assumptions.length > 0 || plan.risks.length > 0 || missing.length > 0) && (
        <div className="cs-plan-more">
          {plan.assumptions.length > 0 && (
            <details className="cs-disc">
              <summary>
                Assumptions <span className="cs-count">{plan.assumptions.length}</span>
              </summary>
              <ul>
                {plan.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          {plan.risks.length > 0 && (
            <details className="cs-disc">
              <summary>
                Risks <span className="cs-count">{plan.risks.length}</span>
              </summary>
              <ul>
                {plan.risks.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          {missing.length > 0 && (
            <details className="cs-disc">
              <summary>
                Open questions <span className="cs-count">{missing.length}</span>
              </summary>
              <ul>
                {missing.map((m) => (
                  <li key={m.question}>
                    {m.question}
                    {m.whyItMatters && <span className="cs-disc-why"> — {m.whyItMatters}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** Streamed text of the running step, kept scrolled to the latest line. Not a live region: it changes too often to announce. */
function LiveOutput({ agent, text }: { agent: string; text: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div className="cs-live">
      <div className="cs-live-h">
        <span className="pulse" aria-hidden="true" />
        {text ? "Writing" : "Gathering evidence"}
      </div>
      <div ref={ref} className="cs-live-b" role="region" aria-label={`${agent}'s live output`} tabIndex={0}>
        {text ? text.slice(-2500) : `${agent} is gathering evidence…`}
        <span className="cs-caret" aria-hidden="true" />
      </div>
    </div>
  );
}

function StepNode({ step }: { step: ExecutionStep }) {
  return (
    <span className="cs-tl-node" aria-hidden="true">
      {step.status === "COMPLETED" ? <Icon name="check" size={14} /> : step.status === "FAILED" ? <Icon name="x" size={14} /> : step.order + 1}
    </span>
  );
}

function StepItem({ step, partial, sources, charged }: { step: ExecutionStep; partial?: string; sources: TaskSource[]; charged: boolean }) {
  const [open, setOpen] = useState(false);
  const live = step.status === "RUNNING";
  const text = live ? partial ?? step.partialOutput : null;
  const secs = step.startedAt && step.completedAt ? Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000) : null;
  const tokens = step.tokensIn + step.tokensOut;
  const audit = [`Capability ${step.capabilityName} v${step.capabilityVersion}`, step.model ? `model ${step.model}` : null, tokens > 0 ? `${tokens.toLocaleString()} tokens` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={`cs-tl-i st-${step.status}`} data-testid="plan-step" data-status={step.status}>
      <StepNode step={step} />
      <div className="cs-tl-card">
        <div className="cs-tl-top">
          <div className="cs-tl-main">
            <h3 className="cs-tl-title">
              {step.title}
              {step.kind === "revision" && (
                <Tag variant="warn" className="ml-2">
                  Revision
                </Tag>
              )}
            </h3>
            <p className="cs-tl-who">
              <ExecBadge executive={step.executive} size={20} />
              <b>{step.executiveTitle}</b>
              <Icon name="arrow" size={12} />
              <span>{step.agent}</span>
              <span className="cs-cap">{step.capabilityName}</span>
            </p>
          </div>
          <StepStatusTag status={step.status} />
        </div>
        <p className="cs-tl-purpose">{step.purpose}</p>
        {step.summary && step.status === "COMPLETED" && <p className="cs-tl-sum">{step.summary}</p>}
        {live && <LiveOutput agent={step.agent} text={text} />}
        {step.status === "FAILED" && step.error && (
          <p className="cs-tl-err">
            <Icon name="alert" size={14} />
            {step.error}
          </p>
        )}
        {step.status === "PENDING" && step.retryAt && <p className="cs-tl-retry">Retry scheduled {relativeTime(step.retryAt)}.</p>}
        <div className="cs-tl-meta">
          <EvidenceChips ns={step.evidenceNs} />
          {step.attempts > 1 && <span>{step.attempts} attempts</span>}
          {secs !== null && (
            <span>
              <Icon name="clock" size={12} /> {duration(secs)}
            </span>
          )}
          {step.costCents > 0 && (
            <span>
              {eur(step.costCents, { decimals: true })}
              {!charged && <small className="cs-est">estimate</small>}
            </span>
          )}
          {step.output && (
            <button type="button" className="cs-linkbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? "Hide work" : "Show work"}
              <Icon name={open ? "up" : "down"} size={12} />
            </button>
          )}
        </div>
        {open && step.output && (
          <div className="cs-tl-work">
            <ReportMarkdown small sources={sources}>
              {step.output}
            </ReportMarkdown>
            <p className="cs-audit">{audit}</p>
          </div>
        )}
      </div>
    </li>
  );
}

/** Steps executed by the AI Team, ending in the verification gate. */
export function ExecutionTimeline({ execution, partials }: { execution: Execution; partials: Record<string, string> }) {
  const sources = useMemo(() => evidenceToSources(execution.evidence), [execution.evidence]);
  const jump = useCallback((n: number) => focusEvidence(n), []);
  if (!execution.steps.length) {
    return (
      <div className="cs-empty">
        <Icon name="list" size={16} />
        <p>{execution.status === "PLANNING" ? "Steps appear here once the Chief of Staff has planned the work." : "No steps were executed in this attempt."}</p>
      </div>
    );
  }
  const v = execution.verification;
  const gate = v ? (v.status === "FAIL" ? "FAILED" : "COMPLETED") : execution.status === "VERIFYING" ? "RUNNING" : "PENDING";
  return (
    <CiteProvider sources={sources} jump={jump} prefix="ev" targetId={evidenceId}>
      <ol className="cs-tl" aria-label="Execution steps">
        {execution.steps.map((s) => (
          <StepItem key={s.id} step={s} partial={partials[s.id]} sources={sources} charged={execution.costCents > 0} />
        ))}
        <li className={`cs-tl-i cs-tl-gate st-${gate}`}>
          <span className="cs-tl-node" aria-hidden="true">
            <Icon name="shield" size={15} />
          </span>
          <div className="cs-tl-card">
            <div className="cs-tl-top">
              <div className="cs-tl-main">
                <h3 className="cs-tl-title">Verification gate</h3>
                <p className="cs-tl-who">Evidence · success criteria · completeness · consistency</p>
              </div>
              <StepStatusTag status={gate} />
            </div>
            {v && (
              <p className="cs-tl-sum">
                Score {v.score}/100 — {v.summary}{" "}
                <a href="#verification" className="cs-inline-link">
                  See the checks
                </a>
              </p>
            )}
          </div>
        </li>
      </ol>
    </CiteProvider>
  );
}
