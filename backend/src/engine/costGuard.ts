// Monetary budget for one execution: what its model calls and paid searches cost the provider
// may not exceed the run's limit. The token ceiling (budget.ts) bounds tokens; this bounds money,
// across the whole workflow — planning, every step attempt (retries included), revisions and
// verification — not one model call.
//
//   limit     = the smaller of MAX_COST_PER_EXECUTION_EUR and MAX_COST_SHARE_OF_PRICE × the
//               execution's price (its credits at CREDITS_PER_EUR); either can be 0 = off.
//   spent     = the execution's usage events at their recorded cost; failed model calls (recorded
//               without a cost) are priced at their estimated tokens — never assumed free.
//   remaining = the steps still to run plus verification, each model call at its configured price
//               with a conservative size (COST_ESTIMATE_INPUT_TOKENS in, the model's output cap out),
//               plus paid searches.
//
// Checked before every step attempt and before verification: when spent + remaining would pass
// the limit, the execution stops BEFORE spending more and is refunded like any failed execution.
// Before the first step that means nothing beyond planning was spent.
//
// Costs come only from PROVIDER_PRICING (never guessed). When a model in use has no price the
// guard cannot measure money: it reports "unpriced" and the token ceiling still applies.
// Customer-facing text never shows provider costs; the figures go to the operator log.

import type { Execution, ExecutionStep } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { log } from "../lib/log";
import { defaultMaxOutputTokens, describeModel, type ModelTier } from "../ai/llmProvider";
import { priceModelCall, priceToolCall, toEurMicros } from "../billing/pricing";
import { getCapability } from "../org/registry";
import { effectiveSearchProvider } from "../research/search";

/** Model calls a verification round makes at the main tier (assessment + claim check). */
export const VERIFICATION_CALLS = 2;
/** Size assumed for a query-writer call (fast tier): a short JSON reply. */
const QUERY_CALL_TOKENS = { in: 2_000, out: 1_024 };

export interface CostFigure {
  /** Millionths of EUR. */
  eurMicros: number;
  /** False when some part could not be priced: then eurMicros is a lower bound. */
  priced: boolean;
}

/** One unit of work still to come: a plan step (by capability) or the verification round. */
export type WorkUnit = { capability: string } | { verification: true };

const eur = (micros: number) => Math.round(micros) / 1e6;

function modelCallEur(tier: ModelTier, tokensIn: number, tokensOut: number): number | null {
  const { provider, model } = describeModel(tier);
  const cost = priceModelCall({ provider, model, tokensIn, tokensOut });
  return cost ? toEurMicros(cost) : null;
}

/** Cost of one paid web search, 0 when searches are free (Wikipedia, off) and null when unpriced. */
function searchEur(): number | null {
  const provider = effectiveSearchProvider();
  if (provider !== "tavily") return 0;
  const cost = priceToolCall("search:tavily");
  return cost ? toEurMicros(cost) : null;
}

/** Conservative estimate of what `units` will cost at today's configured prices and models. */
export function estimateRemaining(units: WorkUnit[]): CostFigure {
  const mainOut = defaultMaxOutputTokens(describeModel("main").provider);
  const main = modelCallEur("main", config.costGuard.estimatedInputTokensPerCall, mainOut);
  const fast = modelCallEur("fast", QUERY_CALL_TOKENS.in, QUERY_CALL_TOKENS.out);
  const search = searchEur();
  let micros = 0;
  let priced = true;
  const add = (part: number | null, times = 1) => {
    if (part === null) priced = false;
    else micros += part * times;
  };
  for (const u of units) {
    if ("verification" in u) {
      add(main, VERIFICATION_CALLS);
      continue;
    }
    const cap = getCapability(u.capability);
    add(main);
    if (cap?.tools.includes("web_research") && cap.kind !== "synthesis") {
      // One query-writer call, then the searches (executor.gatherEvidence: 3 for research, 2 otherwise).
      add(fast);
      add(search, cap.kind === "research" ? 3 : 2);
    }
  }
  return { eurMicros: Math.round(micros), priced };
}

/** What the execution has cost so far. */
export async function spentSoFar(executionId: string): Promise<CostFigure> {
  const events = await prisma.usageEvent.findMany({
    where: { executionId },
    select: { kind: true, provider: true, model: true, tokensIn: true, tokensOut: true, cachedTokensIn: true, ok: true, costMicros: true, costCurrency: true },
  });
  let micros = 0;
  let priced = true;
  for (const e of events) {
    if (e.costMicros != null && e.costCurrency) {
      const inEur = toEurMicros({ micros: e.costMicros, currency: e.costCurrency });
      if (inEur === null) priced = false;
      else micros += inEur;
      continue;
    }
    if (e.kind === "llm" && e.tokensIn + e.tokensOut > 0) {
      // Unpriced or failed: price it at its (estimated) tokens rather than assume it was free.
      const cost = priceModelCall({ provider: e.provider, model: e.model, tokensIn: e.tokensIn, cachedTokensIn: e.cachedTokensIn, tokensOut: e.tokensOut });
      const inEur = cost ? toEurMicros(cost) : null;
      if (inEur === null) priced = false;
      else micros += inEur;
    }
    // Searches without a cost were free (Wikipedia) or failed before a result was billed.
  }
  return { eurMicros: Math.round(micros), priced };
}

/** The execution's monetary limit in millionths of EUR, or null when no limit applies. */
export function costLimitEurMicros(ex: Pick<Execution, "costCents">): number | null {
  const limits: number[] = [];
  if (config.costGuard.maxEur > 0) limits.push(config.costGuard.maxEur * 1e6);
  const priceEur = ex.costCents / config.creditsPerEur;
  if (config.costGuard.maxShareOfPrice > 0 && priceEur > 0) limits.push(config.costGuard.maxShareOfPrice * priceEur * 1e6);
  return limits.length ? Math.round(Math.min(...limits)) : null;
}

/** Steps still to run (pending, or the one about to run) as work units, plus verification. */
export function remainingWork(steps: Pick<ExecutionStep, "status" | "capability">[], phase: "step" | "verification"): WorkUnit[] {
  const units: WorkUnit[] = phase === "step" ? steps.filter((s) => s.status === "PENDING" || s.status === "RUNNING").map((s) => ({ capability: s.capability })) : [];
  units.push({ verification: true });
  return units;
}

export const COST_LIMIT_MESSAGE =
  "Stopped before going over this run's cost limit: the work still to do was estimated to need more AI capacity than this plan allows. Its credits are refunded. Try a narrower objective, or one with fewer steps.";

/**
 * A customer-readable reason to stop before the next unit of work, or null to go on.
 * Never throws: when the guard itself fails, the run goes on under the token ceiling (logged).
 */
export async function costLimitReached(
  ex: Pick<Execution, "id" | "orgId" | "costCents">,
  steps: Pick<ExecutionStep, "status" | "capability">[],
  phase: "step" | "verification"
): Promise<string | null> {
  try {
    const limit = costLimitEurMicros(ex);
    if (limit === null) return null;
    const spent = await spentSoFar(ex.id);
    const next = estimateRemaining(remainingWork(steps, phase));
    if (!spent.priced || !next.priced) {
      log.debug("execution.cost_unpriced", { executionId: ex.id, phase, spentEur: eur(spent.eurMicros), limitEur: eur(limit) });
      // A lower bound is still a bound: stop if even that is over the limit.
      if (spent.eurMicros >= limit) {
        log.warn("execution.cost_limit", { executionId: ex.id, orgId: ex.orgId, phase, spentEur: eur(spent.eurMicros), limitEur: eur(limit), priced: false });
        return COST_LIMIT_MESSAGE;
      }
      return null;
    }
    if (spent.eurMicros + next.eurMicros > limit) {
      log.warn("execution.cost_limit", {
        executionId: ex.id,
        orgId: ex.orgId,
        phase,
        spentEur: eur(spent.eurMicros),
        remainingEstimateEur: eur(next.eurMicros),
        limitEur: eur(limit),
      });
      return COST_LIMIT_MESSAGE;
    }
    return null;
  } catch (err) {
    log.warn("execution.cost_guard_error", { executionId: ex.id, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
