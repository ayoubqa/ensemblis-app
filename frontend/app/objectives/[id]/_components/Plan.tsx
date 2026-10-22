"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Execution, ExecutionStatus, ExecutionStep, PlanInfo, TaskSource } from "@/lib/api";
import { Icon, StepStatusTag, Tag, VerificationTag } from "@/components";
import { ResearchTag, providerName } from "@/components/Tags";
import { CiteProvider, ReportMarkdown } from "@/components/report";
import { ExecBadge, evidenceToSources } from "@/components/ops";
import { duration, eur, relativeTime } from "@/lib/format";
import { UNFINISHED_STEP, unfinishedStep, verificationStopped } from "@/lib/openIssues";
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

const BLOCKED_TITLE: Record<NonNullable<PlanInfo["blocked"]>["kind"], string> = {
  config: "The AI provider isn't configured",
  quota: "The AI provider is out of quota",
  search_unavailable: "Web search is unavailable",
};

type Blocked = NonNullable<PlanInfo["blocked"]>;
const blockedTitle = (b: Blocked) => BLOCKED_TITLE[b.kind] ?? "This plan can't run yet";
/** The server's message often starts with the same words as the title ("The AI provider isn't configured: …"). */
const repeatsTitle = (b: Blocked) => !!b.message && b.message.trim().toLowerCase().startsWith(blockedTitle(b).toLowerCase());
/** The bold lead of the notice: the message itself when it already says what the title would. */
function blockedLead(b: Blocked): string {
  if (repeatsTitle(b)) return b.message.trim();
  return `${blockedTitle(b)}.`;
}

/** Model time: "850 ms", "4.2 s". */
export function latency(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** Shown next to token counts that are estimates (≈4 characters per token). Only counts recorded as measured go without it. */
export function EstTag() {
  return (
    <small className="cs-est" title="Not measured by the provider: estimated at about 4 characters per token, or not recorded as measured.">
      ≈ est.
    </small>
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
      {plan.blocked && (
        <div className="cs-empty is-warn cs-plan-blocked" role="note" data-testid="plan-blocked" data-kind={plan.blocked.kind}>
          <Icon name="alert" size={16} />
          <p>
            <b>{blockedLead(plan.blocked)}</b> {plan.blocked.message && !repeatsTitle(plan.blocked) ? `${plan.blocked.message} ` : ""}
            Nothing has been charged.
            {plan.source === "fallback" && work.length > 0 && " The steps below are the standard playbook, not a plan from the Chief of Staff's model."}
          </p>
        </div>
      )}
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

function StepItem({ step, partial, sources, charged, runStatus }: { step: ExecutionStep; partial?: string; sources: TaskSource[]; charged: boolean; runStatus: ExecutionStatus }) {
  const [open, setOpen] = useState(false);
  const live = step.status === "RUNNING";
  const text = live ? partial ?? step.partialOutput : null;
  const secs = step.startedAt && step.completedAt ? Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000) : null;
  const tokens = step.tokensIn + step.tokensOut;
  const audit = `Capability ${step.capabilityName} v${step.capabilityVersion}`;
  // Where the step ran: shown for every step that called a model, failed ones included.
  const ran = !!(step.provider || step.model || tokens > 0);
  const modelTime = latency(step.latencyMs);
  const research = step.researchStatus ?? null;
  const researchDetail =
    research === "ok" || research === "degraded"
      ? (step.research?.providers ?? []).map(providerName).join(" + ") || null
      : null;
  // The run ended without finishing this step ("Not run" / "Stopped"); otherwise a skip is a person's.
  const unfinished = unfinishedStep(step, runStatus);
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
          {unfinished ? (
            <Tag variant="gray" title={UNFINISHED_STEP[unfinished].title}>
              {UNFINISHED_STEP[unfinished].label}
            </Tag>
          ) : (
            <StepStatusTag status={step.status} />
          )}
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
        {unfinished === "stopped" && step.error && (
          // An unfinished step keeps an error only while it waits to retry (starting an attempt clears it).
          <p className="cs-tl-err is-skip">
            <Icon name="info" size={14} />
            <span>
              The execution ended while this step was waiting to retry after a failed attempt. <span className="cs-tl-err-why">{step.error}</span>
            </span>
          </p>
        )}
        {step.status === "SKIPPED" && step.kind === "work" && step.error && !unfinished && (
          <p className="cs-tl-err is-skip" data-testid="step-skipped-why">
            <Icon name="info" size={14} />
            <span>
              {/* A cancelled or failed run delivered no result to leave the step out of. */}
              Skipped after it failed
              {runStatus === "COMPLETED" ? " — the result was produced without it." : runStatus === "CANCELLED" || runStatus === "FAILED" ? "." : " — the result will be produced without it."}{" "}
              <span className="cs-tl-err-why">{step.error}</span>
            </span>
          </p>
        )}
        {step.status === "PENDING" && step.retryAt && <p className="cs-tl-retry">Retry scheduled {relativeTime(step.retryAt)}.</p>}
        {ran && (
          <p className="cs-tl-model" data-testid="step-meta">
            <span>
              <span className="sr-only">Model: </span>
              {providerName(step.provider)}
              {step.model && step.model !== step.provider ? ` · ${step.model}` : ""}
            </span>
            <span>
              {step.tokensIn.toLocaleString("en-US")} in / {step.tokensOut.toLocaleString("en-US")} out tokens
              {step.tokensEstimated !== false && <EstTag />}
            </span>
            {modelTime && <span>{modelTime} model time</span>}
          </p>
        )}
        <div className="cs-tl-meta">
          {research && <ResearchTag status={research} detail={researchDetail} />}
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
  // A finished execution with no verification either ended while the gate was working (every work
  // step finished: "Stopped") or never reached it (cancelled, rejected or failed first: "Not run").
  const gateStopped = verificationStopped(execution);
  const gateNotRun = !v && !gateStopped && ["COMPLETED", "FAILED", "CANCELLED"].includes(execution.status);
  const gate = v
    ? v.status === "FAIL"
      ? "FAILED"
      : v.status === "UNVERIFIED"
        ? "UNVERIFIED"
        : "COMPLETED"
    : execution.status === "VERIFYING"
      ? "RUNNING"
      : gateStopped || gateNotRun
        ? "SKIPPED"
        : "PENDING";
  return (
    <CiteProvider sources={sources} linkDomains={execution.linkDomains} jump={jump} prefix="ev" targetId={evidenceId}>
      <ol className="cs-tl" aria-label="Execution steps">
        {execution.steps.map((s) => (
          <StepItem key={s.id} step={s} partial={partials[s.id]} sources={sources} charged={execution.costCents > 0} runStatus={execution.status} />
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
              {v ? (
                <VerificationTag status={v.status} />
              ) : gateStopped ? (
                <Tag variant="gray" title="The execution ended while its result was being verified.">
                  {UNFINISHED_STEP.stopped.label}
                </Tag>
              ) : gateNotRun ? (
                <Tag variant="gray" title="The execution ended before its result was verified.">
                  {UNFINISHED_STEP.not_run.label}
                </Tag>
              ) : (
                <StepStatusTag status={gate === "RUNNING" ? "RUNNING" : "PENDING"} />
              )}
            </div>
            {v && (
              <p className="cs-tl-sum">
                {v.status === "UNVERIFIED" ? "The AI review could not run, so the result is not verified." : `Score ${v.score}/100 — ${v.summary}`}{" "}
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
