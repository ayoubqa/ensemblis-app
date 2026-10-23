// Budget protections around the engine (credits are charged in billing.ts).
//
//   - The server-wide daily token budget (ai/dailyBudget.ts) refuses new work
//     that today's remaining budget could not finish.
//   - Planning costs a model call but no credits, so an organization that
//     can't afford even the cheapest possible plan is refused BEFORE the
//     planner runs (no provider spend for work that could never start).
//   - Each execution has a runaway ceiling on model tokens
//     (MAX_TOKENS_PER_EXECUTION). Checked before every step attempt and before
//     verification; past it the execution fails, which refunds what was
//     charged (lifecycle.failExecution). Step, retry and output limits already
//     bound each call (planner MAX_STEPS, MAX_STEP_ATTEMPTS, OPENAI_MAX_TOKENS).

import { prisma } from "../db";
import { config } from "../config";
import { HttpError } from "../lib/http";
import { formatCredits } from "../billing/credits";
import { CAPABILITIES, VERIFICATION_COST_CENTS } from "../org/registry";
import type { OrgContext } from "../org/organization";
import { assertDailyTokenBudgetForNewWork } from "../ai/dailyBudget";

/**
 * The cheapest plan the planner can produce: framing + the cheapest work
 * step + synthesis (plans have 3 to 7 steps) + the verification fee.
 */
export function minimumPlanCost(): number {
  const cost = (kind: string) => Math.min(...CAPABILITIES.filter((c) => c.kind === kind).map((c) => c.costCents));
  const work = Math.min(...CAPABILITIES.filter((c) => c.kind !== "framing" && c.kind !== "synthesis").map((c) => c.costCents));
  return cost("framing") + work + cost("synthesis") + VERIFICATION_COST_CENTS;
}

/** 402 before planning when the paying wallet can't afford any plan at all. */
export async function assertCanAffordPlanning(org: Pick<OrgContext, "walletUserId" | "userId">): Promise<void> {
  // The server's daily token budget comes first: no plan starts that couldn't be finished today.
  await assertDailyTokenBudgetForNewWork();
  const wallet = await prisma.user.findUnique({ where: { id: org.walletUserId }, select: { credits: true } });
  if (!wallet) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  const min = minimumPlanCost();
  if (wallet.credits < min) {
    const whose = org.walletUserId === org.userId ? "your balance" : "your team's balance";
    throw new HttpError(
      402,
      `Not enough credits to plan this objective: the smallest possible plan costs ${formatCredits(min)} and ${whose} is ${formatCredits(wallet.credits)}. Add credits in Usage first.`
    );
  }
}

/** Model tokens an execution has used so far (all its LLM calls, ok or not). */
export async function executionTokens(executionId: string): Promise<number> {
  const agg = await prisma.usageEvent.aggregate({ where: { executionId, kind: "llm" }, _sum: { tokensIn: true, tokensOut: true } });
  return (agg._sum.tokensIn ?? 0) + (agg._sum.tokensOut ?? 0);
}

/** A customer-readable reason to stop, when the execution has reached its token ceiling; null otherwise. */
export async function tokenCeilingReached(executionId: string): Promise<string | null> {
  const cap = config.maxTokensPerExecution;
  if (!cap) return null;
  const used = await executionTokens(executionId);
  if (used < cap) return null;
  return `Stopped at the safety limit: this execution used ${used.toLocaleString("en-US")} model tokens (limit ${cap.toLocaleString("en-US")}). Its credits are refunded.`;
}
