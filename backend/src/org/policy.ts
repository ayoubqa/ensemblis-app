// Execution policy: which tools may run, and when a person must approve.
// Pure functions — unit tested in tests/unit/policy.test.ts.

import type { Autonomy, RiskLevel } from "@prisma/client";
import { getCapability } from "./registry";
import { TOOLS, type ToolKey, type ToolPermission } from "./tools";

/**
 * Permission levels an organization grants to agents. This release grants
 * READ_ONLY only: research, analysis, drafting and recommendations. Anything
 * that writes, acts externally, moves money or deletes is denied.
 */
export const DEFAULT_TOOL_GRANTS: readonly ToolPermission[] = ["READ_ONLY"];

/** Levels that, once granted in a future release, still need an ACTION approval per use. */
export const APPROVAL_REQUIRED_PERMISSIONS: readonly ToolPermission[] = ["WRITE", "EXTERNAL_ACTION", "FINANCIAL", "DESTRUCTIVE"];

export interface ToolAccess {
  tool: string;
  allowed: boolean;
  permission: ToolPermission | null;
  reason: string | null;
}

/** Can an agent use this tool under the given grants? Unknown tools are always denied. */
export function checkToolAccess(tool: string, grants: readonly ToolPermission[] = DEFAULT_TOOL_GRANTS): ToolAccess {
  const def = (TOOLS as Record<string, (typeof TOOLS)[ToolKey] | undefined>)[tool];
  if (!def) return { tool, allowed: false, permission: null, reason: `Unknown tool "${tool}"` };
  if (!grants.includes(def.permission)) {
    return {
      tool,
      allowed: false,
      permission: def.permission,
      reason: `${def.name} needs ${def.permission} permission, which this organization has not granted.`,
    };
  }
  return { tool, allowed: true, permission: def.permission, reason: null };
}

/** Tools a capability is bound to that the policy denies. Empty = allowed to run. */
export function deniedToolsFor(capabilityKey: string, grants: readonly ToolPermission[] = DEFAULT_TOOL_GRANTS): ToolAccess[] {
  const cap = getCapability(capabilityKey);
  if (!cap) return [{ tool: capabilityKey, allowed: false, permission: null, reason: `Unknown capability "${capabilityKey}"` }];
  return cap.tools.map((t) => checkToolAccess(t, grants)).filter((a) => !a.allowed);
}

// ---------------------------------------------------------------- approvals

export interface ApprovalInput {
  autonomy: Autonomy;
  estimatedCostCents: number;
  budgetCents: number;
  approvalThresholdCents: number;
  capabilityKeys: string[];
  criteriaCount: number;
}

export interface ApprovalDecision {
  required: boolean;
  kind: "PLAN" | "BUDGET" | "ACTION" | null;
  reasons: string[];
  risk: RiskLevel;
  recommendedDecision: "APPROVE" | "REJECT";
  recommendation: string;
}

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/**
 * Decides whether an execution may start on its own. Approval is required when:
 *   - the organization asked to review plans (autonomy REVIEW_PLAN);
 *   - the estimate exceeds the objective's budget, or the org's approval threshold;
 *   - any step uses a tool above READ_ONLY (future write-capable capabilities).
 */
export function decideApproval(input: ApprovalInput): ApprovalDecision {
  const reasons: string[] = [];
  let kind: ApprovalDecision["kind"] = null;

  const writeTools = input.capabilityKeys.flatMap((k) =>
    (getCapability(k)?.tools ?? []).filter((t) => APPROVAL_REQUIRED_PERMISSIONS.includes(TOOLS[t].permission))
  );
  if (writeTools.length) {
    kind = "ACTION";
    reasons.push(`The plan uses tools that act outside Ensemblis (${[...new Set(writeTools)].join(", ")}).`);
  }
  const overBudget = input.estimatedCostCents > input.budgetCents;
  if (overBudget) {
    kind = kind ?? "BUDGET";
    reasons.push(`The estimated cost (${eur(input.estimatedCostCents)}) is above this objective's budget (${eur(input.budgetCents)}).`);
  }
  const overThreshold = input.estimatedCostCents > input.approvalThresholdCents;
  if (overThreshold) {
    kind = kind ?? "BUDGET";
    reasons.push(
      `The estimated cost (${eur(input.estimatedCostCents)}) is above your organization's approval threshold (${eur(input.approvalThresholdCents)}).`
    );
  }
  if (input.autonomy === "REVIEW_PLAN") {
    kind = kind ?? "PLAN";
    reasons.push("Your autonomy setting asks for the plan to be reviewed before work starts.");
  }

  const risk: RiskLevel = writeTools.length ? "HIGH" : overBudget || overThreshold ? "MEDIUM" : "LOW";
  const required = reasons.length > 0;
  let recommendedDecision: ApprovalDecision["recommendedDecision"] = "APPROVE";
  let recommendation: string;
  if (writeTools.length) {
    recommendedDecision = "REJECT";
    recommendation = "Reject unless you have reviewed exactly which external actions will be taken. This release only runs read-only work.";
  } else if (overBudget) {
    recommendedDecision = "APPROVE";
    recommendation = `Approve only if the result is worth ${eur(input.estimatedCostCents)}; otherwise reject and narrow the objective or raise its budget.`;
  } else {
    recommendation =
      `Approve. The plan is read-only research and analysis` +
      (input.criteriaCount ? ` that addresses ${input.criteriaCount} success criteri${input.criteriaCount === 1 ? "on" : "a"}` : "") +
      `, and the estimate of ${eur(input.estimatedCostCents)} is within budget.`;
  }
  return { required, kind: required ? kind : null, reasons, risk, recommendedDecision, recommendation };
}
