// Outcome measurement: did the execution achieve the objective?
//
// For each success criterion the verifier's assessment is recorded, with the
// evidence numbers it relies on. Numeric criteria (targetValue) are compared
// deterministically against the measured value. Nothing is invented: a
// criterion nobody could assess is UNKNOWN, and the overall outcome is
// UNKNOWN when no criterion was assessed (always when the result could not
// be verified).
//
// An evidence-backed research brief is held to more: a criterion about
// evidence that the verifier marked MET without linking any source is only
// partially met; "supported by cited evidence" follows the deterministic
// evidence-support check, not the model's reading; and the brief is ACHIEVED
// only when verification PASSed with no unsupported or uncited claim.
// Value records (cost, cycle time, estimated hours) are the foundation for
// later ROI tracking; estimates are flagged as estimates.

import type { CriterionResult, OutcomeStatus, Prisma, SuccessCriterion, VerificationStatus } from "@prisma/client";
import { isResearchBrief } from "./prompts";
import type { CheckStatus, CriterionAssessment, ModelAssessment } from "./verification/checks";

export interface CriterionMeasurement {
  criterionId: string;
  result: CriterionResult;
  measuredValue: number | null;
  measurement: string;
  explanation: string;
  method: "model-assessed" | "deterministic" | "not-assessed";
  /** Evidence numbers [n] the verdict relies on. */
  evidenceNs: number[];
}

const UPPER_BOUND = /\b(under|below|less than|fewer than|at most|no more than|max(imum)?|within|cap(ped)?|up to|lower than|not exceed(ing)?|or less|reduc(e|es|ed|ing)|cut|lower(s|ed|ing)?|decreas(e|es|ed|ing)|shrink(s|ing)?)\b/i;
const RANK: Record<CriterionResult, number> = { MET: 3, PARTIALLY_MET: 2, NOT_MET: 1, UNKNOWN: 0 };
/** The more conservative of two results (UNKNOWN from the model doesn't override a count). */
function worse(counted: CriterionResult, judged: CriterionResult): CriterionResult {
  if (judged === "UNKNOWN") return counted;
  return RANK[judged] < RANK[counted] ? judged : counted;
}

const refsOf = (a: CriterionAssessment | undefined) => [...new Set((a?.evidence ?? []).filter((n) => Number.isInteger(n) && n >= 1))].sort((x, y) => x - y);

export function measureCriterion(c: Pick<SuccessCriterion, "id" | "description" | "targetValue" | "unit">, a: CriterionAssessment | undefined): CriterionMeasurement {
  if (!a) {
    return {
      criterionId: c.id,
      result: "UNKNOWN",
      measuredValue: null,
      measurement: "Not assessed",
      explanation: "The AI verifier could not assess this criterion. Confirm it yourself.",
      method: "not-assessed",
      evidenceNs: [],
    };
  }
  const evidenceNs = refsOf(a);
  // The deterministic count only applies to "at least N" targets ("three markets", "10 leads"). For a
  // cap ("CAC under €50", "within 30 days") a bigger number is worse, so the verifier's own status stands.
  if (c.targetValue != null && a.measuredValue != null && !UPPER_BOUND.test(c.description)) {
    const ratio = c.targetValue === 0 ? (a.measuredValue === 0 ? 1 : 0) : a.measuredValue / c.targetValue;
    const counted: CriterionResult = ratio >= 1 ? "MET" : ratio >= 0.5 ? "PARTIALLY_MET" : "NOT_MET";
    // Never better than the verifier's judgement: three markets listed but two unsupported is not MET.
    const result = worse(counted, a.status);
    return {
      criterionId: c.id,
      result,
      measuredValue: a.measuredValue,
      measurement: a.measurement || `${a.measuredValue}${c.unit ? ` ${c.unit}` : ""} (target ${c.targetValue}${c.unit ? ` ${c.unit}` : ""})`,
      explanation: a.explanation,
      method: "deterministic",
      evidenceNs,
    };
  }
  return { criterionId: c.id, result: a.status, measuredValue: a.measuredValue, measurement: a.measurement, explanation: a.explanation, method: "model-assessed", evidenceNs };
}

// ---------------------------------------------------------------- research-brief criterion rules

/** A criterion about evidence, sources, citations or data. */
export const EVIDENCE_CRITERION = /\b(evidence|evidenced|sources?|sourced|cite[sd]?|citing|citations?|data)\b/i;
/**
 * "… supported by (cited) evidence", "backed by (external) sources", "… cites an external source":
 * what the deterministic evidence-support check measures, so it decides (never better than the verifier).
 */
export const SUPPORTED_BY_EVIDENCE =
  /\b(?:(?:supported|backed)\s+by\s+(?:the\s+)?(?:cited\s+)?(?:external\s+)?(?:evidence|sources?)|cit(?:e|es|ed|ing)\s+(?:an?\s+|the\s+|its\s+)?(?:external\s+)?(?:evidence|sources?))\b/i;

const NOT_LINKED = "Not linked to evidence: the verifier named no source for this criterion, so it counts as partially met.";

/**
 * Applies the research-brief criterion rules to a model assessment (other objectives are returned unchanged):
 *   - a criterion matching SUPPORTED_BY_EVIDENCE follows the citation_support check
 *     (fail → NOT_MET, warn → PARTIALLY_MET, pass → MET), never better than the verifier's own verdict;
 *   - a MET criterion about evidence (EVIDENCE_CRITERION) with no evidence refs becomes PARTIALLY_MET.
 * Pure and idempotent. The result is what gets stored in Verification.assessment, so the API shows it.
 */
export function applyCriteriaRules(
  model: ModelAssessment | null,
  opts: {
    objectiveKind?: string | null;
    criteria: string[];
    citationSupport?: CheckStatus | null;
    /** Evidence numbers of the claims the evidence-support check found (refs for a mapped criterion the verifier left without any). */
    supportEvidence?: number[];
  }
): ModelAssessment | null {
  if (!model || !isResearchBrief(opts.objectiveKind)) return model;
  const byIdx = new Map(model.criteria.map((c) => [c.index, c]));
  const out: CriterionAssessment[] = [];
  opts.criteria.forEach((description, i) => {
    const index = i + 1;
    const a = byIdx.get(index);
    let next: CriterionAssessment | undefined = a ? { ...a, evidence: refsOf(a) } : undefined;
    const support = opts.citationSupport;
    if (SUPPORTED_BY_EVIDENCE.test(description) && (support === "fail" || support === "warn" || support === "pass")) {
      const mapped: CriterionResult = support === "fail" ? "NOT_MET" : support === "warn" ? "PARTIALLY_MET" : "MET";
      const status = worse(mapped, next?.status ?? "UNKNOWN");
      const why =
        support === "fail"
          ? "The evidence-support check failed: cited claims were not found in their sources, or no external source backs the brief."
          : support === "warn"
            ? "The evidence-support check passed with warnings: some cited claims match their sources only partly."
            : "The evidence-support check found the cited claims in their sources.";
      next = {
        index,
        status,
        measuredValue: next?.measuredValue ?? null,
        measurement: next?.measurement || "Evidence-support check",
        explanation: next?.explanation?.startsWith(why) ? next.explanation : [why, next?.explanation].filter(Boolean).join(" "),
        evidence: next?.evidence?.length ? next.evidence : status === "NOT_MET" ? [] : [...new Set(opts.supportEvidence ?? [])].sort((x, y) => x - y).slice(0, 12),
      };
    }
    if (next && next.status === "MET" && EVIDENCE_CRITERION.test(description) && !(next.evidence ?? []).length) {
      next = { ...next, status: "PARTIALLY_MET", explanation: [NOT_LINKED, next.explanation].filter(Boolean).join(" ") };
    }
    if (next) out.push(next);
  });
  // Keep any verdict for an index past the criteria list out (the assessor already drops those).
  return { ...model, criteria: out };
}

export function overallOutcome(results: CriterionResult[]): OutcomeStatus {
  const assessed = results.filter((r) => r !== "UNKNOWN");
  if (!assessed.length) return "UNKNOWN";
  if (assessed.length === results.length && assessed.every((r) => r === "MET")) return "ACHIEVED";
  if (assessed.some((r) => r === "MET" || r === "PARTIALLY_MET")) return "PARTIALLY_ACHIEVED";
  return "NOT_ACHIEVED";
}

export function outcomeSummary(ms: CriterionMeasurement[]): string {
  const n = ms.length;
  const met = ms.filter((m) => m.result === "MET").length;
  const part = ms.filter((m) => m.result === "PARTIALLY_MET").length;
  const unknown = ms.filter((m) => m.result === "UNKNOWN").length;
  if (!n) return "No success criteria were defined.";
  return [`${met} of ${n} success criteri${n === 1 ? "on" : "a"} met`, part ? `${part} partially` : "", unknown ? `${unknown} not assessed` : ""].filter(Boolean).join(", ") + ".";
}

/**
 * The overall outcome after the caps:
 *   - an unverified result is never measured (UNKNOWN);
 *   - a result accepted despite failing verification can't count as fully achieved;
 *   - a research brief is ACHIEVED only when verification PASSed with no unsupported or uncited claim.
 */
export function cappedOutcome(
  status: OutcomeStatus,
  args: { acceptedDespiteFailure: boolean; objectiveKind?: string | null; verificationStatus?: VerificationStatus | null; hasUnsupported?: boolean }
): OutcomeStatus {
  if (args.verificationStatus === "UNVERIFIED") return "UNKNOWN";
  if (status !== "ACHIEVED") return status;
  if (args.acceptedDespiteFailure) return "PARTIALLY_ACHIEVED";
  if (isResearchBrief(args.objectiveKind) && (args.verificationStatus !== "PASS" || args.hasUnsupported)) return "PARTIALLY_ACHIEVED";
  return status;
}

export async function recordOutcome(
  tx: Prisma.TransactionClient,
  args: {
    executionId: string;
    criteria: SuccessCriterion[];
    model: ModelAssessment | null;
    acceptedDespiteFailure: boolean;
    /** Objective.kind: the research-brief rules apply to "research_brief". */
    objectiveKind?: string | null;
    /** The latest verification round's status. */
    verificationStatus?: VerificationStatus | null;
    /** The latest round has an UNSUPPORTED or UNCITED claim. */
    hasUnsupported?: boolean;
  }
): Promise<{ status: OutcomeStatus; summary: string; measurements: CriterionMeasurement[] }> {
  // The citation_support mapping is applied when the round is verified (service.ts); the evidence-link rule again here (idempotent).
  const model = args.verificationStatus === "UNVERIFIED" ? null : applyCriteriaRules(args.model, { objectiveKind: args.objectiveKind, criteria: args.criteria.map((c) => c.description) });
  const byIdx = new Map((model?.criteria ?? []).map((c) => [c.index, c]));
  const measurements = args.criteria.map((c, i) => measureCriterion(c, byIdx.get(i + 1)));
  for (const m of measurements) {
    const data = { result: m.result, measuredValue: m.measuredValue, measurement: m.measurement.slice(0, 300), explanation: m.explanation, method: m.method, evidenceNs: m.evidenceNs };
    await tx.outcomeMeasurement.upsert({
      where: { executionId_criterionId: { executionId: args.executionId, criterionId: m.criterionId } },
      update: data,
      create: { executionId: args.executionId, criterionId: m.criterionId, ...data },
    });
  }
  const status = cappedOutcome(overallOutcome(measurements.map((m) => m.result)), args);
  return { status, summary: outcomeSummary(measurements), measurements };
}
