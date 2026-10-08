// Model-based assessment for the verification gate: objective alignment,
// per-criterion results and internal consistency. The answer is validated
// JSON; when the model is unavailable or invalid the gate runs on its
// deterministic checks alone and marks these checks "not assessed" (never "pass").

import { z } from "zod";
import { runStructured } from "../../ai/structured";
import { listOf, looseEnum, num, strList, text } from "../../ai/lenient";
import { clip } from "../../research/text";
import { block, TRUST_RULES } from "../prompts";
import type { ClaimResult, ModelAssessment } from "./checks";

// Tolerant (ai/lenient.ts): a long rationale, "85" for a score or "met" for MET
// must not throw away the whole assessment.
const schema = z.object({
  objectiveAlignment: z.object({ score: num().pipe(z.number().min(0).max(100)), rationale: text(600).default("") }),
  criteria: listOf(
    z.object({
      index: num().pipe(z.number().int().min(1).max(20)),
      status: looseEnum<"MET" | "PARTIALLY_MET" | "NOT_MET" | "UNKNOWN">(["MET", "PARTIALLY_MET", "NOT_MET", "UNKNOWN"]),
      measuredValue: num().nullable().optional().catch(null),
      measurement: text(200).default(""),
      explanation: text(600).default(""),
    }),
    20
  ).default([]),
  consistencyIssues: strList(8, 300).default([]),
  humanJudgment: strList(6, 300).default([]),
});

export async function assessResult(args: {
  executionId: string;
  objectiveTitle: string;
  statement: string;
  criteria: { description: string; targetValue: number | null; unit: string | null }[];
  report: string;
  claimResults: ClaimResult[];
}): Promise<ModelAssessment | null> {
  const system = [
    "You are the verification lead of an AI organization. You judge whether a result achieves a business objective. You reply with ONE JSON object only.",
    TRUST_RULES,
    "## Rules",
    "- Judge only what the result actually says. Do not reward confident wording.",
    "- For each success criterion give MET / PARTIALLY_MET / NOT_MET / UNKNOWN, what you measured (e.g. \"3 markets recommended\") and, for numeric criteria, measuredValue.",
    "- consistencyIssues: contradictions inside the result (figures or conclusions that disagree). Empty if none.",
    "- humanJudgment: decisions or assumptions a person must confirm before acting.",
    "- You are NOT asked whether claims are true: evidence support was checked separately (see <claims>).",
    'JSON: {"objectiveAlignment": {"score": 0-100, "rationale": str}, "criteria": [{"index": 1, "status": "MET", "measuredValue": number|null, "measurement": str, "explanation": str}], "consistencyIssues": [str], "humanJudgment": [str]}',
  ].join("\n");
  const claimsSummary = args.claimResults
    .slice(0, 20)
    .map((c) => `- [${c.status}] ${c.claim.slice(0, 160)}`)
    .join("\n");
  const user = [
    block("objective", `Title: ${args.objectiveTitle}\n\n${clip(args.statement, 3000)}`, "user-instruction"),
    block(
      "success_criteria",
      args.criteria.map((c, i) => `${i + 1}. ${c.description}${c.targetValue != null ? ` (target: ${c.targetValue}${c.unit ? ` ${c.unit}` : ""})` : ""}`).join("\n") || "(none)",
      "user-instruction"
    ),
    block("result", clip(args.report, 14000), "internal"),
    block("claims", claimsSummary || "(no checkable claims)", "internal"),
  ].join("\n\n");
  try {
    const res = await runStructured(system, user, schema, { model: "main", purpose: "verify", executionId: args.executionId, temperature: 0, maxTokens: 3000 });
    if (!res.ok) return null;
    const d = res.data;
    return {
      alignmentScore: d.objectiveAlignment.score,
      alignmentRationale: d.objectiveAlignment.rationale,
      criteria: d.criteria
        .filter((c) => c.index <= args.criteria.length)
        .map((c) => ({ index: c.index, status: c.status, measuredValue: c.measuredValue ?? null, measurement: c.measurement, explanation: c.explanation })),
      consistencyIssues: d.consistencyIssues,
      humanJudgment: d.humanJudgment,
    };
  } catch {
    return null;
  }
}
