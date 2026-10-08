// Outcome measurement: did the execution achieve the objective?
//
// For each success criterion the verifier's assessment is recorded. Numeric
// criteria (targetValue) are compared deterministically against the measured
// value. Nothing is invented: a criterion nobody could assess is UNKNOWN, and
// the overall outcome is UNKNOWN when no criterion was assessed.
// Value records (cost, cycle time, estimated hours) are the foundation for
// later ROI tracking; estimates are flagged as estimates.

import type { CriterionResult, OutcomeStatus, Prisma, SuccessCriterion } from "@prisma/client";
import type { CriterionAssessment, ModelAssessment } from "./verification/checks";

export interface CriterionMeasurement {
  criterionId: string;
  result: CriterionResult;
  measuredValue: number | null;
  measurement: string;
  explanation: string;
  method: "model-assessed" | "deterministic" | "not-assessed";
}

const UPPER_BOUND = /\b(under|below|less than|fewer than|at most|no more than|max(imum)?|within|cap(ped)?|up to|lower than|not exceed(ing)?|or less)\b/i;
const RANK: Record<CriterionResult, number> = { MET: 3, PARTIALLY_MET: 2, NOT_MET: 1, UNKNOWN: 0 };
/** The more conservative of two results (UNKNOWN from the model doesn't override a count). */
function worse(counted: CriterionResult, judged: CriterionResult): CriterionResult {
  if (judged === "UNKNOWN") return counted;
  return RANK[judged] < RANK[counted] ? judged : counted;
}

export function measureCriterion(c: Pick<SuccessCriterion, "id" | "description" | "targetValue" | "unit">, a: CriterionAssessment | undefined): CriterionMeasurement {
  if (!a) {
    return {
      criterionId: c.id,
      result: "UNKNOWN",
      measuredValue: null,
      measurement: "Not assessed",
      explanation: "The AI verifier could not assess this criterion. Confirm it yourself.",
      method: "not-assessed",
    };
  }
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
    };
  }
  return { criterionId: c.id, result: a.status, measuredValue: a.measuredValue, measurement: a.measurement, explanation: a.explanation, method: "model-assessed" };
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

export async function recordOutcome(
  tx: Prisma.TransactionClient,
  args: { executionId: string; criteria: SuccessCriterion[]; model: ModelAssessment | null; acceptedDespiteFailure: boolean }
): Promise<{ status: OutcomeStatus; summary: string; measurements: CriterionMeasurement[] }> {
  const byIdx = new Map((args.model?.criteria ?? []).map((c) => [c.index, c]));
  const measurements = args.criteria.map((c, i) => measureCriterion(c, byIdx.get(i + 1)));
  for (const m of measurements) {
    await tx.outcomeMeasurement.upsert({
      where: { executionId_criterionId: { executionId: args.executionId, criterionId: m.criterionId } },
      update: { result: m.result, measuredValue: m.measuredValue, measurement: m.measurement.slice(0, 300), explanation: m.explanation, method: m.method },
      create: {
        executionId: args.executionId,
        criterionId: m.criterionId,
        result: m.result,
        measuredValue: m.measuredValue,
        measurement: m.measurement.slice(0, 300),
        explanation: m.explanation,
        method: m.method,
      },
    });
  }
  let status = overallOutcome(measurements.map((m) => m.result));
  // A result a person accepted despite failing verification can't count as fully achieved.
  if (args.acceptedDespiteFailure && status === "ACHIEVED") status = "PARTIALLY_ACHIEVED";
  return { status, summary: outcomeSummary(measurements), measurements };
}
