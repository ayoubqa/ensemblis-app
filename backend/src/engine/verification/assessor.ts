// Model-based assessment for the verification gate: objective alignment,
// per-criterion results and internal consistency. The answer is validated
// JSON; when the model is unavailable or invalid the gate runs on its
// deterministic checks alone and marks these checks "not assessed" (never "pass").

import { z } from "zod";
import { runLLM } from "../../ai/llmProvider";
import { parseStructured } from "../../ai/json";
import { clip } from "../../research/text";
import { block, TRUST_RULES } from "../prompts";
import type { ClaimResult, ModelAssessment } from "./checks";

const schema = z.object({
  objectiveAlignment: z.object({ score: z.number().min(0).max(100), rationale: z.string().max(600).default("") }),
  criteria: z
    .array(
      z.object({
        index: z.number().int().min(1).max(20),
        status: z.enum(["MET", "PARTIALLY_MET", "NOT_MET", "UNKNOWN"]),
        measuredValue: z.number().finite().nullable().optional(),
        measurement: z.string().max(200).default(""),
        explanation: z.string().max(600).default(""),
      })
    )
    .max(20)
    .default([]),
  consistencyIssues: z.array(z.string().max(300)).max(8).default([]),
  humanJudgment: z.array(z.string().max(300)).max(6).default([]),
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
    const { text } = await runLLM(system, user, { model: "main", purpose: "verify", executionId: args.executionId, temperature: 0, maxTokens: 3000 });
    const parsed = parseStructured(text, schema);
    if (!parsed.ok) return null;
    const d = parsed.data;
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
