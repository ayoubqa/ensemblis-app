"use client";

import type { ReactNode } from "react";
import type {
  ClaimStatus,
  ClaimType,
  CriterionResult,
  ExceptionKind,
  ExecutionStatus,
  ObjectiveStatus,
  OutcomeStatus,
  ResearchStatus,
  ResultState,
  RiskLevel,
  StepStatus,
  VerificationStatus,
} from "@/lib/api";
import { Icon, type IconName } from "./Icon";

export type TagVariant = "accent" | "ok" | "warn" | "bad" | "gray";

/** `.tag` pill. variant accent = default (electric blue). */
export function Tag({ variant = "accent", icon, children, title, className }: { variant?: TagVariant; icon?: IconName; children: ReactNode; title?: string; className?: string }) {
  const cls = ["tag", variant !== "accent" && variant, className].filter(Boolean).join(" ");
  return (
    <span className={cls} title={title}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

const STATUS: Record<ObjectiveStatus, { label: string; variant: TagVariant; live?: boolean }> = {
  DRAFT: { label: "Draft", variant: "gray" },
  PLANNING: { label: "Planning", variant: "accent", live: true },
  PLANNED: { label: "Planned", variant: "accent" },
  WAITING_FOR_APPROVAL: { label: "Awaiting approval", variant: "warn" },
  RUNNING: { label: "Executing", variant: "accent", live: true },
  BLOCKED: { label: "Needs attention", variant: "warn" },
  VERIFYING: { label: "Verifying", variant: "accent", live: true },
  COMPLETED: { label: "Completed", variant: "ok" },
  FAILED: { label: "Failed", variant: "bad" },
  CANCELLED: { label: "Cancelled", variant: "gray" },
};

/** "SOME_STATUS" → "Some status": a readable fallback for a status this build doesn't know yet. */
const humanize = (s: string) => (s ? `${s.charAt(0)}${s.slice(1).toLowerCase().replace(/_/g, " ")}` : "Unknown");

/** Human label for every objective / execution status (RUNNING reads "Executing"). */
export function statusLabel(s: ObjectiveStatus | ExecutionStatus): string {
  return STATUS[s]?.label ?? humanize(String(s));
}

export function isLiveStatus(s: ObjectiveStatus | ExecutionStatus | undefined | null): boolean {
  return !!s && !!STATUS[s]?.live;
}

/** Objective / execution status (running states get a live pulse). */
export function StatusTag({ status }: { status: ObjectiveStatus | ExecutionStatus }) {
  const m = STATUS[status] ?? { label: humanize(String(status)), variant: "gray" as TagVariant };
  return (
    <span className={["tag", m.variant !== "accent" && m.variant].filter(Boolean).join(" ")} data-status={status}>
      {m.live && <span className="pulse" aria-hidden="true" />}
      {m.label}
    </span>
  );
}

const STEP: Record<StepStatus, { label: string; variant: TagVariant }> = {
  PENDING: { label: "Waiting", variant: "gray" },
  RUNNING: { label: "Working", variant: "accent" },
  COMPLETED: { label: "Done", variant: "ok" },
  FAILED: { label: "Failed", variant: "bad" },
  SKIPPED: { label: "Skipped", variant: "gray" },
};

export function StepStatusTag({ status }: { status: StepStatus }) {
  const m = STEP[status];
  return (
    <span className={["tag", m.variant !== "accent" && m.variant].filter(Boolean).join(" ")}>
      {status === "RUNNING" && <span className="pulse" aria-hidden="true" />}
      {m.label}
    </span>
  );
}

const OUTCOME: Record<OutcomeStatus, { label: string; variant: TagVariant; icon: IconName }> = {
  ACHIEVED: { label: "Achieved", variant: "ok", icon: "check" },
  PARTIALLY_ACHIEVED: { label: "Partially achieved", variant: "warn", icon: "flag" },
  NOT_ACHIEVED: { label: "Not achieved", variant: "bad", icon: "x" },
  UNKNOWN: { label: "Not measured", variant: "gray", icon: "info" },
};

export function outcomeLabel(o: OutcomeStatus | null | undefined): string {
  return o ? OUTCOME[o]?.label ?? humanize(String(o)) : "—";
}

/** Suffix of an outcome nobody has confirmed: it is the AI verifier's reading of the report, not a fact about the business. */
export const AI_ASSESSED = "(AI-assessed)";

/**
 * "Achieved (AI-assessed)" until a person confirms it ("Achieved"). "Not measured" never
 * carries the suffix: nothing was assessed.
 */
export function outcomeTagLabel(o: OutcomeStatus | null | undefined, confirmed = false): string {
  if (!o) return "—";
  return confirmed || o === "UNKNOWN" ? outcomeLabel(o) : `${outcomeLabel(o)} ${AI_ASSESSED}`;
}

/**
 * The outcome tag. Unless `confirmed` (a person confirmed it), the label says it is AI-assessed:
 * call sites that don't know are honest by default.
 */
export function OutcomeTag({ outcome, confirmed = false }: { outcome: OutcomeStatus | null | undefined; confirmed?: boolean }) {
  if (!outcome) return null;
  const m = OUTCOME[outcome] ?? { variant: "gray" as TagVariant, icon: "info" as IconName };
  const title =
    outcome === "UNKNOWN"
      ? "The outcome could not be measured."
      : confirmed
        ? "Confirmed by a person."
        : "The AI verifier's reading of the report against the success criteria — not confirmed by a person.";
  return (
    <Tag variant={m.variant} icon={confirmed ? "user" : m.icon} title={title}>
      {outcomeTagLabel(outcome, confirmed)}
    </Tag>
  );
}

const VERIFY: Record<VerificationStatus, { label: string; variant: TagVariant }> = {
  PASS: { label: "Verified", variant: "ok" },
  PASS_WITH_WARNINGS: { label: "Verified with warnings", variant: "warn" },
  FAIL: { label: "Failed verification", variant: "bad" },
  UNVERIFIED: { label: "Not verified", variant: "warn" },
};

export function verificationLabel(status: VerificationStatus | null | undefined): string {
  return status ? VERIFY[status]?.label ?? humanize(String(status)) : "—";
}

export function VerificationTag({ status, score }: { status: VerificationStatus | null | undefined; score?: number | null }) {
  if (!status) return null;
  const m = VERIFY[status] ?? { label: humanize(String(status)), variant: "gray" as TagVariant };
  return (
    <Tag variant={m.variant} icon="shield" title={status === "UNVERIFIED" ? "The AI verifier could not run, so this result has not been verified." : undefined}>
      {m.label}
      {/* An UNVERIFIED round has no meaningful score. */}
      {score != null && status !== "UNVERIFIED" ? ` · ${score}` : ""}
    </Tag>
  );
}

// ---------------------------------------------------------------- result state

const RESULT: Record<ResultState, { label: string; variant: TagVariant; icon: IconName; report: string }> = {
  in_progress: { label: "In progress", variant: "accent", icon: "clock", report: "Draft — not yet verified" },
  blocked: { label: "Paused", variant: "warn", icon: "alert", report: "Draft — not yet verified" },
  failed: { label: "Failed", variant: "bad", icon: "x", report: "Draft — the execution failed" },
  cancelled: { label: "Cancelled", variant: "gray", icon: "x", report: "Draft — the execution was cancelled" },
  verified: { label: "Verified result", variant: "ok", icon: "shield", report: "Verified report" },
  verified_with_warnings: { label: "Verified with warnings", variant: "warn", icon: "shield", report: "Verified with warnings" },
  partial: { label: "Partial result", variant: "warn", icon: "flag", report: "Partial report — some planned work is missing" },
  unverified: { label: "Not verified", variant: "warn", icon: "info", report: "Not verified — the verifier could not run" },
  accepted_failed_verification: {
    label: "Accepted — failed verification",
    variant: "bad",
    icon: "alert",
    report: "Did not pass verification — accepted as it is",
  },
};

/** "Verified result", "Partial result", "Accepted — failed verification"… */
export function resultStateLabel(state: ResultState | null | undefined): string {
  return state ? RESULT[state]?.label ?? humanize(String(state)) : "—";
}

/** The tone of a result state (colour is never the only signal: the label says it too). */
export function resultStateTone(state: ResultState | null | undefined): TagVariant {
  return state ? RESULT[state]?.variant ?? "gray" : "gray";
}

/** What an exported or shared report is labelled with. */
export function resultReportLabel(state: ResultState | null | undefined): string {
  return state ? RESULT[state]?.report ?? "Report" : "Report";
}

/** The overall result of an execution. `suffix` (e.g. the verification score) is appended. */
export function ResultStateTag({ state, suffix }: { state: ResultState; suffix?: string | null }) {
  const m = RESULT[state] ?? { label: humanize(String(state)), variant: "gray" as TagVariant, icon: "info" as IconName };
  return (
    <span className={["tag", m.variant !== "accent" && m.variant].filter(Boolean).join(" ")} data-testid="result-state" data-state={state}>
      <Icon name={m.icon} />
      {m.label}
      {suffix ? ` · ${suffix}` : ""}
    </span>
  );
}

// ---------------------------------------------------------------- exceptions

const EXCEPTION_KIND: Record<ExceptionKind, string> = {
  MISSING_INFORMATION: "Missing information",
  STEP_FAILED: "Step failed",
  VERIFICATION_FAILED: "Verification failed",
  INSUFFICIENT_FUNDS: "Insufficient balance",
  POLICY_BLOCKED: "Blocked by policy",
  PROVIDER_UNAVAILABLE: "Provider unavailable",
};

export function exceptionKindLabel(kind: ExceptionKind | string): string {
  return EXCEPTION_KIND[kind as ExceptionKind] ?? humanize(String(kind));
}

// ---------------------------------------------------------------- research

const RESEARCH: Record<ResearchStatus, { label: string; variant: TagVariant; title: string }> = {
  ok: { label: "Web research", variant: "ok", title: "The web search answered and returned sources." },
  degraded: { label: "Research degraded", variant: "warn", title: "A search provider failed and a fallback was used." },
  no_results: { label: "No sources found", variant: "warn", title: "The search ran but returned no usable sources." },
  failed: { label: "Research failed", variant: "bad", title: "No search succeeded: no external sources were retrieved." },
  off: { label: "Web search off", variant: "gray", title: "Web search is off on this server, so this step ran without web research." },
};

export function researchStatusLabel(status: ResearchStatus | null | undefined): string {
  return status ? RESEARCH[status]?.label ?? humanize(String(status)) : "—";
}

/** What a step's web research achieved. `detail` (e.g. the providers that answered) is appended. */
export function ResearchTag({ status, detail, title }: { status: ResearchStatus; detail?: string | null; title?: string }) {
  const m = RESEARCH[status] ?? { label: humanize(String(status)), variant: "gray" as TagVariant, title: "" };
  return (
    <span className={["tag", m.variant !== "accent" && m.variant].filter(Boolean).join(" ")} title={title ?? m.title} data-testid="research-badge" data-research={status}>
      <Icon name={status === "ok" ? "search" : status === "off" ? "info" : "alert"} />
      {m.label}
      {detail ? ` · ${detail}` : ""}
    </span>
  );
}

/** Display name of a search or model provider ("tavily" → "Tavily"). */
export function providerName(p: string | null | undefined): string {
  if (!p) return "—";
  const known: Record<string, string> = { tavily: "Tavily", wikipedia: "Wikipedia", openai: "OpenAI-compatible", anthropic: "Anthropic", ollama: "Ollama", mock: "Mock AI" };
  return known[p] ?? p;
}

const CRITERION: Record<CriterionResult, { label: string; variant: TagVariant }> = {
  MET: { label: "Met", variant: "ok" },
  PARTIALLY_MET: { label: "Partially met", variant: "warn" },
  NOT_MET: { label: "Not met", variant: "bad" },
  UNKNOWN: { label: "Not assessed", variant: "gray" },
};

export function CriterionTag({ result }: { result: CriterionResult }) {
  const m = CRITERION[result];
  return <Tag variant={m.variant}>{m.label}</Tag>;
}

const CLAIM: Record<ClaimStatus, { label: string; variant: TagVariant; title: string }> = {
  SUPPORTED: { label: "Supported", variant: "ok", title: "The cited evidence contains this claim's figures and key terms." },
  PARTIALLY_SUPPORTED: { label: "Partly supported", variant: "warn", title: "Only part of the claim appears in the cited evidence." },
  UNSUPPORTED: { label: "Not found in evidence", variant: "bad", title: "The cited evidence doesn't contain this claim." },
  UNCITED: { label: "Uncited figure", variant: "warn", title: "A specific figure with no citation and no estimate label." },
  ESTIMATE: { label: "Estimate", variant: "gray", title: "Labelled as an estimate." },
};

export function ClaimTag({ status }: { status: ClaimStatus }) {
  const m = CLAIM[status] ?? { label: humanize(String(status)), variant: "gray" as TagVariant, title: "" };
  return (
    <span className={["tag", m.variant].join(" ")} title={m.title}>
      {m.label}
    </span>
  );
}

const CLAIM_TYPE: Record<ClaimType, { label: string; title: string }> = {
  source: { label: "Sourced fact", title: "Stated as a fact taken from a cited source." },
  inference: { label: "Inference", title: "A conclusion drawn from the sources, not stated in them." },
  uncertainty: { label: "Uncertainty", title: "Something the evidence leaves open." },
  recommendation: { label: "Recommendation", title: "Advice: a judgment, never supported by evidence alone." },
};

export function claimTypeLabel(t: ClaimType | null | undefined): string {
  return t ? CLAIM_TYPE[t]?.label ?? humanize(String(t)) : "—";
}

/** What kind of statement a claim is (from the report section it appears in). */
export function ClaimTypeTag({ type }: { type: ClaimType }) {
  const m = CLAIM_TYPE[type] ?? { label: humanize(String(type)), title: "" };
  return (
    <span className="tag gray" title={m.title} data-testid="claim-type" data-type={type}>
      {m.label}
    </span>
  );
}

export function RiskTag({ risk }: { risk: RiskLevel }) {
  const v: TagVariant = risk === "HIGH" ? "bad" : risk === "MEDIUM" ? "warn" : "ok";
  return <Tag variant={v}>{risk === "HIGH" ? "High risk" : risk === "MEDIUM" ? "Medium risk" : "Low risk"}</Tag>;
}
