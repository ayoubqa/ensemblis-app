// Monetary budget for one execution: before each unit of work, what its model calls and paid searches
// have cost the provider, plus a conservative estimate of the rest, is checked against the run's limit.
// The token ceiling (budget.ts) bounds tokens; this checks money across the whole workflow — planning
// (counted, though it runs before the first check), every step attempt (retries included), revisions,
// verification and the memory call — not one model call.
//
//   limit     = the smaller of MAX_COST_PER_EXECUTION_EUR and MAX_COST_SHARE_OF_PRICE × the
//               execution's price (its credits at CREDITS_PER_EUR); either can be 0 = off.
//   spent     = the execution's usage events. Measured: costs recorded from provider-reported
//               usage. Estimated: failed calls and HTTP retries at their (estimated) tokens, and
//               token counts the provider didn't report — never assumed free.
//   remaining = the steps still to run, verification (with its repair calls) and the memory call,
//               each model call at its configured price with a conservative size
//               (COST_ESTIMATE_INPUT_TOKENS in, the call's output cap out), plus paid searches.
//
// Checked before every step attempt, before verification and before the memory call: when spent +
// remaining would pass the limit, the execution stops BEFORE spending more and is refunded like any
// failed execution (the memory call is skipped instead: the result is already measured).
//
// This is a pre-call check, not a hard cap: one call can cost more than estimated before the next
// check (a prompt larger than COST_ESTIMATE_INPUT_TOKENS), and planning runs before the first check.
//
// Costs come only from PROVIDER_PRICING (never guessed). Without PROVIDER_PRICING the guard is
// inactive (warned on boot) and the token ceiling still applies. With it, anything in use that has
// no price (a model, a paid search, an exchange rate) follows COST_GUARD_UNPRICED: "stop" (default)
// stops the run before spending more; "allow" checks only what is priced. When the guard itself
// fails while a limit applies, the run stops too.
// Customer-facing text never shows provider costs; the figures go to the operator log.

import type { Execution, ExecutionStep } from "@prisma/client";
import { prisma } from "../db";
import { config, mockAIForbidden } from "../config";
import { log } from "../lib/log";
import { defaultMaxOutputTokens, describeModel, type ModelTier } from "../ai/llmProvider";
import { repairMaxTokens } from "../ai/structured";
import { priceModelCall, priceToolCall, pricingConfigured, pricingTable, toEurMicros, type PricedCost } from "../billing/pricing";
import { getCapability } from "../org/registry";
import { effectiveSearchProvider } from "../research/search";
import { QUERY_MAX_TOKENS } from "../research/sources";
import { ASSESSOR_MAX_TOKENS } from "./verification/assessor";
import { CLAIM_CHECK_MAX_TOKENS } from "./verification/claimCheck";
import { MEMORY_MAX_TOKENS } from "./learning";

/** Input assumed for a query-writer call: its prompt is clipped to ~3,200 characters of objective and brief. */
const QUERY_INPUT_TOKENS = 2_000;
/** Usage that costs nothing by design (`kind:provider`). Anything else without a price is reported as unpriced. */
const FREE_USAGE = new Set(["search:wikipedia", "fetch:web"]);

export interface CostFigure {
  /** Millionths of EUR from recorded costs: provider-reported tokens, or a paid search, at the configured price. */
  measuredMicros: number;
  /** Millionths of EUR that are estimates, used by the guard only and never recorded as a cost: failed calls,
   *  HTTP retries and unreported token counts at their estimated tokens, and the work still to come. */
  estimatedMicros: number;
  /** What could not be priced ("model openai:gpt-x", "search:tavily", "fx USD"). Empty when everything was. */
  unpriced: string[];
}

/** One unit of work still to come: a plan step (by capability), the verification round, or the memory call. */
export type WorkUnit = { capability: string } | { verification: true } | { memory: true };

/** Where the guard is checked: before a step attempt, before verification, or before the memory call. */
export type GuardPhase = "step" | "verification" | "memory";

export const costTotal = (f: CostFigure) => f.measuredMicros + f.estimatedMicros;

const eur = (micros: number) => Math.round(micros) / 1e6;

type Priced = { micros: number } | { missing: string };

function inEur(cost: PricedCost | null, missing: string): Priced {
  if (!cost) return { missing };
  const micros = toEurMicros(cost);
  return micros === null ? { missing: `fx ${cost.currency}` } : { micros };
}

class Tally {
  measured = 0;
  estimated = 0;
  missing = new Set<string>();
  add(p: Priced, as: "measured" | "estimated", times = 1) {
    if ("missing" in p) this.missing.add(p.missing);
    else this[as] += p.micros * times;
  }
  figure(): CostFigure {
    return { measuredMicros: Math.round(this.measured), estimatedMicros: Math.round(this.estimated), unpriced: [...this.missing].sort() };
  }
}

function modelCall(tier: ModelTier, tokensIn: number, tokensOut: number): Priced {
  const { provider, model } = describeModel(tier);
  return inEur(priceModelCall({ provider, model, tokensIn, tokensOut }), `model ${provider}:${model}`);
}

/** Cost of one paid web search: 0 when searches are free (Wikipedia, off). */
function searchCall(): Priced {
  if (effectiveSearchProvider() !== "tavily") return { micros: 0 };
  return inEur(priceToolCall("search:tavily"), "search:tavily");
}

/** Conservative estimate of what `units` will cost at today's configured prices and models. */
export function estimateRemaining(units: WorkUnit[]): CostFigure {
  const t = new Tally();
  const inTok = config.costGuard.estimatedInputTokensPerCall;
  const mainOut = defaultMaxOutputTokens(describeModel("main").provider);
  for (const u of units) {
    if ("verification" in u) {
      // The assessor and the claim check, each with the repair call runStructured makes after an unusable reply.
      for (const cap of [ASSESSOR_MAX_TOKENS, CLAIM_CHECK_MAX_TOKENS]) {
        t.add(modelCall("main", inTok, cap), "estimated");
        t.add(modelCall("main", inTok, repairMaxTokens(cap)), "estimated");
      }
      continue;
    }
    if ("memory" in u) {
      t.add(modelCall("fast", inTok, MEMORY_MAX_TOKENS), "estimated");
      continue;
    }
    const cap = getCapability(u.capability);
    t.add(modelCall("main", inTok, mainOut), "estimated");
    if (cap?.tools.includes("web_research") && cap.kind !== "synthesis") {
      // One query-writer call, then the searches (executor.gatherEvidence: 3 for research, 2 otherwise).
      t.add(modelCall("fast", QUERY_INPUT_TOKENS, QUERY_MAX_TOKENS), "estimated");
      t.add(searchCall(), "estimated", cap.kind === "research" ? 3 : 2);
    }
  }
  return t.figure();
}

/** What the execution has cost so far. */
export async function spentSoFar(executionId: string): Promise<CostFigure> {
  const events = await prisma.usageEvent.findMany({
    where: { executionId },
    select: {
      kind: true,
      provider: true,
      model: true,
      tokensIn: true,
      tokensOut: true,
      cachedTokensIn: true,
      ok: true,
      estimated: true,
      attempts: true,
      costMicros: true,
      costCurrency: true,
      costSource: true,
    },
  });
  const t = new Tally();
  for (const e of events) {
    const key = `${e.kind}:${e.provider}`;
    if (FREE_USAGE.has(key)) continue;
    const recorded = e.costMicros != null && e.costCurrency ? { micros: e.costMicros, currency: e.costCurrency } : null;
    if (e.kind === "llm") {
      const label = `model ${e.provider}:${e.model ?? "unknown"}`;
      const tokens = { provider: e.provider, model: e.model, tokensIn: e.tokensIn, cachedTokensIn: e.cachedTokensIn };
      if (recorded) t.add(inEur(recorded, label), e.costSource === "estimated" ? "estimated" : "measured");
      else if (e.tokensIn + e.tokensOut > 0) {
        // Failed (never priced when recorded) or priced since: price it at its tokens rather than assume it was free.
        t.add(inEur(priceModelCall({ ...tokens, tokensOut: e.tokensOut }), label), !e.ok || e.estimated ? "estimated" : "measured");
      }
      // Each HTTP retry happened before any output, but may still have been billed for its input: an upper bound.
      if (e.ok && e.attempts && e.attempts > 1) t.add(inEur(priceModelCall({ ...tokens, tokensOut: 0 }), label), "estimated", e.attempts - 1);
      continue;
    }
    if (e.kind === "search") {
      // A failed paid search may still have been billed: counted at its price, as an estimate.
      t.add(inEur(recorded ?? priceToolCall(key), key), e.ok ? "measured" : "estimated");
      continue;
    }
    // Nothing else tied to an execution has a price model: report it rather than count it free.
    t.add({ missing: key }, "measured");
  }
  return t.figure();
}

/** The execution's monetary limit in millionths of EUR, or null when no limit applies. */
export function costLimitEurMicros(ex: Pick<Execution, "costCents">): number | null {
  const limits: number[] = [];
  if (config.costGuard.maxEur > 0) limits.push(config.costGuard.maxEur * 1e6);
  const priceEur = ex.costCents / config.creditsPerEur;
  if (config.costGuard.maxShareOfPrice > 0 && priceEur > 0) limits.push(config.costGuard.maxShareOfPrice * priceEur * 1e6);
  return limits.length ? Math.round(Math.min(...limits)) : null;
}

/** The work still to come from `phase`: pending steps (or the one about to run), verification, the memory call. */
export function remainingWork(steps: Pick<ExecutionStep, "status" | "capability">[], phase: GuardPhase): WorkUnit[] {
  const units: WorkUnit[] = phase === "step" ? steps.filter((s) => s.status === "PENDING" || s.status === "RUNNING").map((s) => ({ capability: s.capability })) : [];
  if (phase !== "memory") units.push({ verification: true });
  units.push({ memory: true });
  return units;
}

export const COST_LIMIT_MESSAGE =
  "Stopped at this run's cost limit: the work still to do was estimated to need more AI capacity than this plan allows. Its credits are refunded. Try a narrower objective, or one with fewer steps.";

/** The run's cost could not be checked (something is unpriced, or the guard failed): it stops rather than spend unchecked. */
export const COST_UNCHECKED_MESSAGE = "Stopped before spending more: this run's cost couldn't be checked against its limit. Its credits are refunded. Try again later.";

/**
 * A customer-readable reason to stop before the next unit of work, or null to go on.
 * Never throws. With no limit (both off, or a run with no price) or no PROVIDER_PRICING it always goes
 * on; otherwise an unpriced cost follows COST_GUARD_UNPRICED, and a failure of the guard itself stops the run.
 */
export async function costLimitReached(
  ex: Pick<Execution, "id" | "orgId" | "costCents">,
  steps: Pick<ExecutionStep, "status" | "capability">[],
  phase: GuardPhase
): Promise<string | null> {
  let limit: number | null = null;
  try {
    limit = costLimitEurMicros(ex);
    if (limit === null || !pricingConfigured()) return null;
    const spent = await spentSoFar(ex.id);
    const next = estimateRemaining(remainingWork(steps, phase));
    const unpriced = [...new Set([...spent.unpriced, ...next.unpriced])].sort();
    const figures = {
      executionId: ex.id,
      orgId: ex.orgId,
      phase,
      spentMeasuredEur: eur(spent.measuredMicros),
      spentEstimatedEur: eur(spent.estimatedMicros),
      remainingEstimateEur: eur(costTotal(next)),
      limitEur: eur(limit),
      ...(unpriced.length ? { unpriced } : {}),
    };
    // With something unpriced the total is a lower bound — over the limit already means stop.
    if (costTotal(spent) + costTotal(next) > limit) {
      log.warn("execution.cost_limit", figures);
      return COST_LIMIT_MESSAGE;
    }
    if (!unpriced.length) return null;
    if (config.costGuard.unpriced === "allow") {
      log.warn("execution.cost_unpriced", { ...figures, policy: "allow" });
      return null;
    }
    log.warn("execution.cost_unchecked", { ...figures, reason: "unpriced" });
    return COST_UNCHECKED_MESSAGE;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("execution.cost_guard_error", { executionId: ex.id, phase, error });
    return limit === null ? null : COST_UNCHECKED_MESSAGE;
  }
}

/** What the guard can and can't price with the current configuration. Logged on boot in production. */
export function costGuardWarnings(): string[] {
  if (!mockAIForbidden()) return [];
  if (config.costGuard.maxEur <= 0 && config.costGuard.maxShareOfPrice <= 0) {
    return ["The monetary cost guard is off (MAX_COST_PER_EXECUTION_EUR and MAX_COST_SHARE_OF_PRICE are 0): only the token ceiling bounds what a run spends."];
  }
  if (!pricingConfigured()) {
    return [
      "PROVIDER_PRICING is not set: the monetary cost guard can't price anything and is inactive; only the token ceiling (MAX_TOKENS_PER_EXECUTION) bounds what a run spends. Set PROVIDER_PRICING to turn it on.",
    ];
  }
  const raw = process.env.COST_GUARD_UNPRICED?.trim().toLowerCase();
  const warnings = raw && raw !== "stop" && raw !== "allow" ? [`COST_GUARD_UNPRICED="${process.env.COST_GUARD_UNPRICED}" is not "stop" or "allow": using "stop".`] : [];
  // Every run makes main and fast model calls; only runs with web research make paid searches.
  const consequence = (who: string) =>
    config.costGuard.unpriced === "allow"
      ? `the guard checks only the priced part of ${who} (COST_GUARD_UNPRICED=allow)`
      : `${who} stop before spending more and are refunded (COST_GUARD_UNPRICED=stop)`;
  const { problem } = pricingTable();
  if (problem) return [...warnings, `${problem} Until it is fixed, ${consequence("all runs")}.`];
  const missingIn = (calls: Priced[]) => calls.flatMap((p) => ("missing" in p ? [p.missing] : []));
  const models = missingIn([modelCall("main", 1, 1), modelCall("fast", 1, 1)]);
  const missing = [...new Set([...models, ...missingIn([searchCall()])])].sort();
  if (missing.length) warnings.push(`PROVIDER_PRICING has no price for ${missing.join(", ")}: ${consequence(models.length ? "all runs" : "runs with web research")}.`);
  return warnings;
}
