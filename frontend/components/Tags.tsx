"use client";

import type { ReactNode } from "react";
import type { ClaimStatus, CriterionResult, ExecutionStatus, ObjectiveStatus, OutcomeStatus, RiskLevel, StepStatus, VerificationStatus } from "@/lib/api";
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
  return o ? OUTCOME[o].label : "—";
}

export function OutcomeTag({ outcome }: { outcome: OutcomeStatus | null | undefined }) {
  if (!outcome) return null;
  const m = OUTCOME[outcome];
  return <Tag variant={m.variant} icon={m.icon}>{m.label}</Tag>;
}

const VERIFY: Record<VerificationStatus, { label: string; variant: TagVariant }> = {
  PASS: { label: "Verified", variant: "ok" },
  PASS_WITH_WARNINGS: { label: "Verified with warnings", variant: "warn" },
  FAIL: { label: "Failed verification", variant: "bad" },
};

export function VerificationTag({ status, score }: { status: VerificationStatus | null | undefined; score?: number | null }) {
  if (!status) return null;
  const m = VERIFY[status];
  return (
    <Tag variant={m.variant} icon="shield">
      {m.label}
      {score != null ? ` · ${score}` : ""}
    </Tag>
  );
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
  const m = CLAIM[status];
  return (
    <span className={["tag", m.variant].join(" ")} title={m.title}>
      {m.label}
    </span>
  );
}

export function RiskTag({ risk }: { risk: RiskLevel }) {
  const v: TagVariant = risk === "HIGH" ? "bad" : risk === "MEDIUM" ? "warn" : "ok";
  return <Tag variant={v}>{risk === "HIGH" ? "High risk" : risk === "MEDIUM" ? "Medium risk" : "Low risk"}</Tag>;
}
