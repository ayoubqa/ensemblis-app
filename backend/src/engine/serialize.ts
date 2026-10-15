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
  UsageEvent,
  Verification,
} from "@prisma/client";
import { getCapability, getExecutive } from "../org/registry";
import { redact } from "../lib/log";
import { toPublicMemory } from "../memory/service";
import { toPublicEvidence } from "./evidence";
import type { Plan } from "./planner";
import { deriveResultState } from "./resultState";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Provider/search error text shown to people: key-shaped tokens masked (lib/log redact), then clipped. */
export function scrubError(s: string | null | undefined, max = 300): string | null {
  if (!s) return null;
  const masked = redact(s);
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked;
}

export function toPublicCriterion(c: SuccessCriterion) {
  return { id: c.id, order: c.order, description: c.description, kind: c.kind as "qualitative" | "quantitative", targetValue: c.targetValue, unit: c.unit, source: c.source as "user" | "proposed" };
}

/** The step fields a summary needs. provider / researchStatus / capability are optional so narrow selects still type-check. */
export type StepLite = Pick<ExecutionStep, "status" | "title" | "agent" | "executive" | "order" | "kind"> &
  Partial<Pick<ExecutionStep, "provider" | "researchStatus" | "capability">>;

/** Select for StepLite (list and detail summaries). */
export const STEP_LITE_SELECT = {
  status: true,
  title: true,
  agent: true,
  executive: true,
  order: true,
  kind: true,
  provider: true,
  researchStatus: true,
  capability: true,
} as const;

export function progressOf(steps: StepLite[]) {
  const work = steps.filter((s) => s.kind !== "revision" || s.status !== "SKIPPED");
  const done = work.filter((s) => s.status === "COMPLETED").length;
  const running = [...work].sort((a, b) => a.order - b.order).find((s) => s.status === "RUNNING");
  return {
    progress: { done, total: work.length },
    currentStep: running ? { title: running.title, agent: running.agent, executive: running.executive, executiveTitle: getExecutive(running.executive)?.title ?? running.executive } : null,
  };
}

type SummaryInput = Execution & {
  steps?: StepLite[];
  usageEvents?: Pick<UsageEvent, "provider">[];
  verifications?: Pick<Verification, "modelProvider">[];
};

/**
 * True when any part of this execution actually ran on the mock provider: a
 * step, a metered model call or the verifier. Taken from what the execution
 * ran on, not from the server's current configuration.
 */
export function usedMockAIOf(e: {
  steps?: { provider?: string | null }[];
  usageEvents?: { provider: string }[];
  verifications?: { modelProvider?: string | null }[];
}): boolean {
  return (
    (e.steps ?? []).some((s) => s.provider === "mock") ||
    (e.usageEvents ?? []).some((u) => u.provider === "mock") ||
    (e.verifications ?? []).some((v) => v.modelProvider === "mock")
  );
}

export function toExecutionSummary(e: SummaryInput, opts: { objectiveKind?: string | null } = {}) {
  const result = deriveResultState({
    status: e.status,
    verificationStatus: e.verificationStatus,
    steps: e.steps,
    objectiveKind: opts.objectiveKind ?? null,
  });
  return {
    id: e.id,
    attempt: e.attempt,
    status: e.status,
    estimatedCostCents: e.estimatedCostCents,
    costCents: e.costCents,
    refundedCents: e.refundedCents,
    verificationStatus: e.verificationStatus,
    verificationScore: e.verificationScore,
    /** The AI-measured outcome. A person's confirmation is confirmedOutcomeStatus and never overwrites it. */
    outcomeStatus: e.outcomeStatus,
    confirmedOutcomeStatus: e.confirmedOutcomeStatus ?? null,
    outcomeSummary: e.outcomeSummary,
    resultState: result.state,
    resultReasons: result.reasons,
    usedMockAI: usedMockAIOf(e),
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
    executions?: SummaryInput[];
    _count?: { approvals?: number; exceptions?: number };
  }
) {
  const execs = [...(o.executions ?? [])].sort((a, b) => b.attempt - a.attempt);
  return {
    id: o.id,
    title: o.title,
    statement: o.statement,
    contextNotes: o.contextNotes,
    kind: (o.kind === "research_brief" ? "research_brief" : null) as "research_brief" | null,
    constraints: o.constraints ?? null,
    deadline: iso(o.deadline),
    budgetCents: o.budgetCents,
    autonomy: o.autonomy,
    status: o.status,
    outcomeStatus: o.outcomeStatus,
    workflowId: o.workflowId,
    createdBy: o.createdBy ? { id: o.createdBy.id, name: o.createdBy.name } : null,
    criteria: [...(o.criteria ?? [])].sort((a, b) => a.order - b.order).map(toPublicCriterion),
    latestExecution: execs[0] ? toExecutionSummary(execs[0], { objectiveKind: o.kind }) : null,
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
    error: s.error ? redact(s.error) : null,
    provider: s.provider,
    model: s.model,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    /** true: the counts are chars/4 estimates (the provider reported no usage); null: not known. The mock never reports usage. */
    tokensEstimated: s.tokensEstimated ?? (s.provider === "mock" ? true : null),
    latencyMs: s.latencyMs,
    costCents: s.costCents,
    retryAt: iso(s.notBefore),
    startedAt: iso(s.startedAt),
    completedAt: iso(s.completedAt),
    evidenceNs: evidence.filter((e) => e.stepId === s.id).map((e) => e.n),
    researchStatus: toResearchStatus(s.researchStatus),
    research: toPublicResearch(s.research),
  };
}

export type PublicResearchStatus = "ok" | "degraded" | "no_results" | "failed" | "off";
const RESEARCH_STATUSES: readonly string[] = ["ok", "degraded", "no_results", "failed", "off"];
const toResearchStatus = (v: string | null | undefined): PublicResearchStatus | null => (v && RESEARCH_STATUSES.includes(v) ? (v as PublicResearchStatus) : null);

export interface PublicSearchAttempt {
  query: string;
  provider: string;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  resultCount: number;
  ms: number | null;
}

const strings = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, max).map((x) => x.trim().slice(0, len)) : [];
const finiteOr = <T>(v: unknown, fallback: T): number | T => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * What a research step did (ExecutionStep.research): the providers that
 * answered, the queries sent and each search attempt. Only these fields are
 * passed through — never raw provider bodies — and error text is scrubbed.
 */
export function toPublicResearch(raw: unknown): { providers: string[]; queries: string[]; attempts: PublicSearchAttempt[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const attempts: PublicSearchAttempt[] = (Array.isArray(r.attempts) ? r.attempts : []).slice(0, 20).flatMap((a): PublicSearchAttempt[] => {
    if (!a || typeof a !== "object") return [];
    const x = a as Record<string, unknown>;
    return [
      {
        query: typeof x.query === "string" ? x.query.slice(0, 300) : "",
        provider: typeof x.provider === "string" ? x.provider.slice(0, 40) : "unknown",
        ok: x.ok === true,
        httpStatus: finiteOr(x.httpStatus, null),
        error: scrubError(typeof x.error === "string" ? x.error : null, 200),
        resultCount: Math.max(0, Math.round(finiteOr(x.resultCount, 0))),
        ms: finiteOr(x.ms, null),
      },
    ];
  });
  return {
    providers: strings(r.providersUsed ?? r.providers, 5, 40),
    queries: strings(r.queries, 10, 300),
    attempts,
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
    actions: x.actions as ("provide_info" | "proceed" | "retry" | "skip" | "accept" | "cancel")[],
    resolution: x.resolution,
    resolvedAction: x.resolvedAction,
    resolvedAt: iso(x.resolvedAt),
    createdAt: x.createdAt.toISOString(),
  };
}

export type CriterionVerdict = "MET" | "PARTIALLY_MET" | "NOT_MET" | "UNKNOWN";
const VERDICTS: readonly string[] = ["MET", "PARTIALLY_MET", "NOT_MET", "UNKNOWN"];

export interface PublicCriterionAssessment {
  /** 1-based, in success-criterion order. */
  index: number;
  status: CriterionVerdict;
  measuredValue: number | null;
  measurement: string;
  explanation: string;
  /** Evidence numbers [n] the verdict relies on (only numbers that exist in this execution, when known). */
  evidence: number[];
}

/**
 * Per-criterion verdicts from the stored model assessment (Verification.assessment.criteria).
 * Visible from the moment the round is saved, including while a VERIFICATION_FAILED decision is pending.
 */
export function criteriaFromAssessment(assessment: unknown, knownEvidence?: ReadonlySet<number>): PublicCriterionAssessment[] {
  if (!assessment || typeof assessment !== "object") return [];
  const list = (assessment as { criteria?: unknown }).criteria;
  if (!Array.isArray(list)) return [];
  const out: PublicCriterionAssessment[] = [];
  for (const raw of list.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const index = typeof c.index === "number" && Number.isInteger(c.index) && c.index >= 1 ? c.index : null;
    if (index == null || out.some((x) => x.index === index)) continue;
    const status = typeof c.status === "string" && VERDICTS.includes(c.status) ? (c.status as CriterionVerdict) : "UNKNOWN";
    const evidence = Array.isArray(c.evidence)
      ? [...new Set(c.evidence.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1))].filter((n) => !knownEvidence || knownEvidence.has(n)).sort((a, b) => a - b)
      : [];
    out.push({
      index,
      status,
      measuredValue: finiteOr(c.measuredValue, null),
      measurement: typeof c.measurement === "string" ? c.measurement : "",
      explanation: typeof c.explanation === "string" ? c.explanation : "",
      evidence,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function toPublicVerification(v: Verification & { claims?: ClaimCheck[] }, opts: { knownEvidence?: ReadonlySet<number> } = {}) {
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
    /** The model that ran the AI assessment (null when it did not run or was not recorded). */
    modelProvider: v.modelProvider ?? null,
    modelName: v.modelName ?? null,
    /** Why the AI assessment could not run (UNVERIFIED rounds). */
    assessorError: scrubError(v.assessorError, 500),
    criteria: criteriaFromAssessment(v.assessment, opts.knownEvidence),
    claims: [...(v.claims ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        claim: c.claim,
        status: c.status,
        evidenceNs: c.evidenceNs,
        supportScore: c.supportScore,
        note: c.note,
        claimType: (c.claimType ?? null) as "source" | "inference" | "uncertainty" | "recommendation" | null,
        quote: c.quote ?? null,
      })),
    createdAt: v.createdAt.toISOString(),
  };
}

export function toVerificationRound(v: Pick<Verification, "round" | "status" | "score" | "summary" | "method" | "createdAt">) {
  return { round: v.round, status: v.status, score: v.score, summary: v.summary, method: v.method, createdAt: v.createdAt.toISOString() };
}

export function toPublicMeasurement(m: OutcomeMeasurement) {
  return { criterionId: m.criterionId, result: m.result, measuredValue: m.measuredValue, measurement: m.measurement, explanation: m.explanation, method: m.method, evidenceNs: m.evidenceNs ?? [] };
}

/** Why a plan cannot run yet (set by the planner; read optionally so this file does not depend on its type). */
export type PlanBlockedKind = "config" | "quota" | "search_unavailable";
type PlanWithBlocked = Plan & { blocked?: unknown };

function planBlocked(raw: unknown): { kind: PlanBlockedKind; message: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as { kind?: unknown; message?: unknown };
  if (b.kind !== "config" && b.kind !== "quota" && b.kind !== "search_unavailable") return null;
  return { kind: b.kind, message: typeof b.message === "string" ? b.message : "" };
}

export function toPublicPlan(plan: unknown) {
  if (!plan || typeof plan !== "object") return null;
  const p = plan as PlanWithBlocked;
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
    blocked: planBlocked(p.blocked),
  };
}

// ---------------------------------------------------------------- usage

export type UsageLite = Pick<UsageEvent, "kind" | "provider" | "model" | "purpose" | "tokensIn" | "tokensOut" | "latencyMs" | "ok" | "estimated">;

export const USAGE_EVENT_SELECT = {
  kind: true,
  provider: true,
  model: true,
  purpose: true,
  tokensIn: true,
  tokensOut: true,
  latencyMs: true,
  ok: true,
  estimated: true,
} as const;

export interface UsageByPurpose {
  purpose: string;
  provider: string;
  model: string | null;
  calls: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  estimated: boolean;
}

export interface UsageSummary {
  /** Model calls metered for this execution (all purposes: plan, queries, step, verify, verify_claims, memory). */
  calls: number;
  failedCalls: number;
  tokensIn: number;
  tokensOut: number;
  /** Sum of model-call latencies (ms). */
  latencyMs: number;
  /** True when any counted call's tokens are estimates (or were not recorded as measured). */
  estimated: boolean;
  byPurpose: UsageByPurpose[];
  searches: { provider: string; calls: number; failed: number }[];
}

const PURPOSE_ORDER = ["plan", "queries", "step", "verify", "verify_claims", "memory", "suggest"];
const purposeRank = (p: string) => {
  const i = PURPOSE_ORDER.indexOf(p);
  return i === -1 ? PURPOSE_ORDER.length : i;
};

/**
 * Groups an execution's UsageEvents. A call counts as estimated unless it was
 * recorded as measured (estimated === false): rows from before the flag
 * existed, failed calls and the mock are never presented as measured counts.
 */
export function summarizeUsage(events: UsageLite[]): UsageSummary {
  const llm = events.filter((e) => e.kind === "llm");
  const groups = new Map<string, UsageByPurpose>();
  for (const e of llm) {
    const purpose = e.purpose || "other";
    const key = `${purpose}\u0000${e.provider}\u0000${e.model ?? ""}`;
    const g = groups.get(key) ?? { purpose, provider: e.provider, model: e.model ?? null, calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, estimated: false };
    g.calls += 1;
    if (!e.ok) g.failed += 1;
    g.tokensIn += e.tokensIn;
    g.tokensOut += e.tokensOut;
    g.latencyMs += e.latencyMs ?? 0;
    if (e.estimated !== false) g.estimated = true;
    groups.set(key, g);
  }
  const byPurpose = [...groups.values()].sort(
    (a, b) => purposeRank(a.purpose) - purposeRank(b.purpose) || a.purpose.localeCompare(b.purpose) || a.provider.localeCompare(b.provider) || (a.model ?? "").localeCompare(b.model ?? "")
  );
  const searches = new Map<string, { provider: string; calls: number; failed: number }>();
  for (const e of events) {
    if (e.kind !== "search") continue;
    const g = searches.get(e.provider) ?? { provider: e.provider, calls: 0, failed: 0 };
    g.calls += 1;
    if (!e.ok) g.failed += 1;
    searches.set(e.provider, g);
  }
  return {
    calls: llm.length,
    failedCalls: llm.filter((e) => !e.ok).length,
    tokensIn: llm.reduce((n, e) => n + e.tokensIn, 0),
    tokensOut: llm.reduce((n, e) => n + e.tokensOut, 0),
    latencyMs: llm.reduce((n, e) => n + (e.latencyMs ?? 0), 0),
    estimated: byPurpose.some((g) => g.estimated),
    byPurpose,
    searches: [...searches.values()].sort((a, b) => a.provider.localeCompare(b.provider)),
  };
}

/** toPublicEvidence plus where each source came from (provider, query, retrieval, retrieved time). Never `content`. */
export function toPublicExecutionEvidence(x: Evidence) {
  return {
    ...toPublicEvidence(x),
    provider: x.provider ?? null,
    query: x.query ?? null,
    retrievedAt: iso(x.retrievedAt),
    retrieval: (x.retrieval ?? null) as "search_snippet" | "website" | "upload" | "provided" | "page_fetch" | null,
  };
}

export type FullExecution = Execution & {
  steps: ExecutionStep[];
  evidence: Evidence[];
  /** Every round, latest first. */
  verifications: (Verification & { claims: ClaimCheck[] })[];
  measurements: OutcomeMeasurement[];
  approvals: Approval[];
  exceptions: Exception[];
  memories: MemoryItem[];
  events: ExecutionEvent[];
  usageEvents?: UsageLite[];
  objective?: { kind: string | null } | null;
};

export const FULL_EXECUTION_INCLUDE = {
  steps: { orderBy: { order: "asc" as const } },
  evidence: { orderBy: { n: "asc" as const } },
  verifications: { orderBy: { round: "desc" as const }, include: { claims: true } },
  measurements: true,
  approvals: { orderBy: { createdAt: "asc" as const } },
  exceptions: { orderBy: { createdAt: "asc" as const } },
  memories: true,
  events: { orderBy: { id: "desc" as const }, take: 400 },
  usageEvents: { select: USAGE_EVENT_SELECT },
  objective: { select: { kind: true } },
};

export function toPublicExecution(e: FullExecution) {
  const events = [...e.events].sort((a, b) => a.id - b.id);
  const rounds = [...e.verifications].sort((a, b) => b.round - a.round);
  const knownEvidence = new Set(e.evidence.map((x) => x.n));
  return {
    ...toExecutionSummary(e, { objectiveKind: e.objective?.kind ?? null }),
    objectiveId: e.objectiveId,
    plan: toPublicPlan(e.plan),
    plannerVersion: e.plannerVersion,
    summary: e.summary,
    result: e.result,
    errorMessage: e.errorMessage ? redact(e.errorMessage) : null,
    shareToken: e.shareToken,
    estimatedManualHours: e.estimatedManualHours,
    outcomeConfirmedAt: iso(e.outcomeConfirmedAt),
    revisionCount: e.revisionCount,
    steps: e.steps.map((s) => toPublicStep(s, e.evidence)),
    evidence: e.evidence.map(toPublicExecutionEvidence),
    /** The latest round. */
    verification: rounds[0] ? toPublicVerification(rounds[0], { knownEvidence }) : null,
    /** Every round, oldest first (e.g. round 1 FAIL → revision → round 2). */
    verificationHistory: [...rounds].reverse().map(toVerificationRound),
    usage: summarizeUsage(e.usageEvents ?? []),
    measurements: e.measurements.map(toPublicMeasurement),
    approvals: e.approvals.map((a) => toPublicApproval(a)),
    exceptions: e.exceptions.map((x) => toPublicException(x)),
    memories: e.memories.map(toPublicMemory),
    events: events.map(toPublicEvent),
    lastEventId: events.length ? events[events.length - 1].id : 0,
  };
}
