// Public JSON shapes for objectives and executions (mirrored in
// frontend/lib/api.ts). Dates are ISO strings, money integer EUR cents.
// Never exposed: prompts, evidence `content` (only excerpts), document text.

import type {
  Approval,
  ClaimCheck,
  Evidence,
  Exception,
  Execution,
  ExecutionEvent,
  ExecutionStep,
  MemoryItem,
  Objective,
  OutcomeMeasurement,
  SuccessCriterion,
  Verification,
} from "@prisma/client";
import { getCapability, getExecutive } from "../org/registry";
import { toPublicMemory } from "../memory/service";
import { toPublicEvidence } from "./evidence";
import type { Plan } from "./planner";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toPublicCriterion(c: SuccessCriterion) {
  return { id: c.id, order: c.order, description: c.description, kind: c.kind as "qualitative" | "quantitative", targetValue: c.targetValue, unit: c.unit, source: c.source as "user" | "proposed" };
}

type StepLite = Pick<ExecutionStep, "status" | "title" | "agent" | "executive" | "order" | "kind">;

export function progressOf(steps: StepLite[]) {
  const work = steps.filter((s) => s.kind !== "revision" || s.status !== "SKIPPED");
  const done = work.filter((s) => s.status === "COMPLETED").length;
  const running = [...work].sort((a, b) => a.order - b.order).find((s) => s.status === "RUNNING");
  return {
    progress: { done, total: work.length },
    currentStep: running ? { title: running.title, agent: running.agent, executive: running.executive, executiveTitle: getExecutive(running.executive)?.title ?? running.executive } : null,
  };
}

export function toExecutionSummary(e: Execution & { steps?: StepLite[] }) {
  return {
    id: e.id,
    attempt: e.attempt,
    status: e.status,
    estimatedCostCents: e.estimatedCostCents,
    costCents: e.costCents,
    refundedCents: e.refundedCents,
    verificationStatus: e.verificationStatus,
    verificationScore: e.verificationScore,
    outcomeStatus: e.outcomeStatus,
    outcomeSummary: e.outcomeSummary,
    planSource: e.planSource,
    startedAt: iso(e.startedAt),
    completedAt: iso(e.completedAt),
    createdAt: e.createdAt.toISOString(),
    ...progressOf(e.steps ?? []),
  };
}

export function toPublicObjective(
  o: Objective & {
    criteria?: SuccessCriterion[];
    createdBy?: { id: string; name: string } | null;
    executions?: (Execution & { steps?: StepLite[] })[];
    _count?: { approvals?: number; exceptions?: number };
  }
) {
  const execs = [...(o.executions ?? [])].sort((a, b) => b.attempt - a.attempt);
  return {
    id: o.id,
    title: o.title,
    statement: o.statement,
    contextNotes: o.contextNotes,
    deadline: iso(o.deadline),
    budgetCents: o.budgetCents,
    autonomy: o.autonomy,
    status: o.status,
    outcomeStatus: o.outcomeStatus,
    workflowId: o.workflowId,
    createdBy: o.createdBy ? { id: o.createdBy.id, name: o.createdBy.name } : null,
    criteria: [...(o.criteria ?? [])].sort((a, b) => a.order - b.order).map(toPublicCriterion),
    latestExecution: execs[0] ? toExecutionSummary(execs[0]) : null,
    attempts: execs.length,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    completedAt: iso(o.completedAt),
  };
}

export function toPublicStep(s: ExecutionStep, evidence: Evidence[] = []) {
  const cap = getCapability(s.capability);
  return {
    id: s.id,
    key: s.key,
    order: s.order,
    title: s.title,
    purpose: s.purpose,
    executive: s.executive,
    executiveTitle: getExecutive(s.executive)?.title ?? s.executive,
    capability: s.capability,
    capabilityName: cap?.name ?? s.capability,
    capabilityVersion: s.capabilityVersion,
    agent: s.agent,
    dependsOn: s.dependsOn,
    outputs: (s.outputs as string[]) ?? [],
    verification: (s.verification as string[]) ?? [],
    kind: s.kind as "work" | "revision",
    status: s.status,
    attempts: s.attempts,
    summary: s.summary,
    output: s.status === "COMPLETED" ? s.output : null,
    partialOutput: s.status === "RUNNING" ? s.partialOutput : null,
    error: s.error,
    provider: s.provider,
    model: s.model,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    latencyMs: s.latencyMs,
    costCents: s.costCents,
    retryAt: iso(s.notBefore),
    startedAt: iso(s.startedAt),
    completedAt: iso(s.completedAt),
    evidenceNs: evidence.filter((e) => e.stepId === s.id).map((e) => e.n),
  };
}

export function toPublicEvent(e: ExecutionEvent) {
  return {
    id: e.id,
    type: e.type,
    actor: e.actor,
    actorTitle: e.actor === "user" ? "You" : e.actor === "system" ? "Ensemblis" : getExecutive(e.actor)?.title ?? e.actor,
    message: e.message,
    data: e.data,
    stepId: e.stepId,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toPublicApproval(a: Approval, objectiveTitle?: string) {
  return {
    id: a.id,
    objectiveId: a.objectiveId,
    objectiveTitle: objectiveTitle ?? null,
    executionId: a.executionId,
    kind: a.kind,
    status: a.status,
    title: a.title,
    proposedAction: a.proposedAction,
    reason: a.reason,
    costCents: a.costCents,
    risk: a.risk,
    recommendation: a.recommendation,
    recommendedDecision: a.recommendedDecision as "APPROVE" | "REJECT",
    decidedAt: iso(a.decidedAt),
    decisionNote: a.decisionNote,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toPublicException(x: Exception, objectiveTitle?: string) {
  return {
    id: x.id,
    objectiveId: x.objectiveId,
    objectiveTitle: objectiveTitle ?? null,
    executionId: x.executionId,
    stepId: x.stepId,
    kind: x.kind,
    status: x.status,
    severity: x.severity,
    title: x.title,
    whatHappened: x.whatHappened,
    whyItMatters: x.whyItMatters,
    recommendation: x.recommendation,
    neededFromUser: x.neededFromUser,
    questions: (x.questions as { question: string; whyItMatters: string }[]) ?? [],
    actions: x.actions as ("provide_info" | "proceed" | "retry" | "accept" | "cancel")[],
    resolution: x.resolution,
    resolvedAction: x.resolvedAction,
    resolvedAt: iso(x.resolvedAt),
    createdAt: x.createdAt.toISOString(),
  };
}

export function toPublicVerification(v: Verification & { claims?: ClaimCheck[] }) {
  return {
    id: v.id,
    round: v.round,
    status: v.status,
    score: v.score,
    checks: v.checks as { key: string; label: string; status: "pass" | "warn" | "fail" | "not_assessed"; score: number | null; detail: string }[],
    summary: v.summary,
    warnings: v.warnings,
    humanJudgment: v.humanJudgment,
    method: v.method,
    version: v.version,
    claims: [...(v.claims ?? [])].sort((a, b) => a.order - b.order).map((c) => ({ claim: c.claim, status: c.status, evidenceNs: c.evidenceNs, supportScore: c.supportScore, note: c.note })),
    createdAt: v.createdAt.toISOString(),
  };
}

export function toPublicMeasurement(m: OutcomeMeasurement) {
  return { criterionId: m.criterionId, result: m.result, measuredValue: m.measuredValue, measurement: m.measurement, explanation: m.explanation, method: m.method };
}

export function toPublicPlan(plan: unknown) {
  if (!plan || typeof plan !== "object") return null;
  const p = plan as Plan;
  return {
    title: p.title,
    objective: p.objective,
    assumptions: p.assumptions ?? [],
    missingInformation: p.missingInformation ?? [],
    risks: p.risks ?? [],
    notes: p.notes ?? [],
    source: p.source,
    version: p.version,
    estimatedCostCents: p.estimatedCostCents,
    estimatedManualHours: p.estimatedManualHours ?? null,
  };
}

export type FullExecution = Execution & {
  steps: ExecutionStep[];
  evidence: Evidence[];
  verifications: (Verification & { claims: ClaimCheck[] })[];
  measurements: OutcomeMeasurement[];
  approvals: Approval[];
  exceptions: Exception[];
  memories: MemoryItem[];
  events: ExecutionEvent[];
};

export const FULL_EXECUTION_INCLUDE = {
  steps: { orderBy: { order: "asc" as const } },
  evidence: { orderBy: { n: "asc" as const } },
  verifications: { orderBy: { round: "desc" as const }, take: 1, include: { claims: true } },
  measurements: true,
  approvals: { orderBy: { createdAt: "asc" as const } },
  exceptions: { orderBy: { createdAt: "asc" as const } },
  memories: true,
  events: { orderBy: { id: "desc" as const }, take: 400 },
};

export function toPublicExecution(e: FullExecution) {
  const events = [...e.events].sort((a, b) => a.id - b.id);
  return {
    ...toExecutionSummary(e),
    objectiveId: e.objectiveId,
    plan: toPublicPlan(e.plan),
    plannerVersion: e.plannerVersion,
    summary: e.summary,
    result: e.result,
    errorMessage: e.errorMessage,
    shareToken: e.shareToken,
    estimatedManualHours: e.estimatedManualHours,
    outcomeConfirmedAt: iso(e.outcomeConfirmedAt),
    revisionCount: e.revisionCount,
    steps: e.steps.map((s) => toPublicStep(s, e.evidence)),
    evidence: e.evidence.map((x) => toPublicEvidence(x)),
    verification: e.verifications[0] ? toPublicVerification(e.verifications[0]) : null,
    measurements: e.measurements.map(toPublicMeasurement),
    approvals: e.approvals.map((a) => toPublicApproval(a)),
    exceptions: e.exceptions.map((x) => toPublicException(x)),
    memories: e.memories.map(toPublicMemory),
    events: events.map(toPublicEvent),
    lastEventId: events.length ? events[events.length - 1].id : 0,
  };
}
