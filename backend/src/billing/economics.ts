// Internal unit economics (owner dashboard / operators only; never customers).
//
//   contribution = credit value consumed − variable cost
//   gross margin = contribution / credit value consumed
//
// Credit value is the euro value of the NET credits an execution consumed
// (charged − refunded) at CREDITS_PER_EUR. While credits are demo/trial
// credits this is list-price value, not revenue — say so wherever it is shown.
// Variable cost is the sum of priced usage events (billing/pricing.ts):
// model calls and paid tools. Events without a configured price, failed calls
// (cost unknown) and events in a currency without an exchange rate are
// counted, not guessed, and make the figure "incomplete". Not included at all:
// fixed hosting, payment fees (payments are off), taxes.

import { prisma } from "../db";
import { config } from "../config";
import { creditValueEurCents } from "./credits";
import { pricingTable, suggestedCredits, toEurMicros } from "./pricing";

export const EXCLUDED_COSTS = ["fixed hosting and database plans", "payment processing fees (payments are disabled)", "taxes"];

interface UsageRow {
  kind: string;
  ok: boolean;
  estimated: boolean | null;
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn: number | null;
  costMicros: number | null;
  costCurrency: string | null;
}

export interface CostSummary {
  /** Sum of every priced, convertible event, in millionths of EUR. */
  eurMicros: number;
  /** True when every event has a known cost in EUR (otherwise eurMicros is a lower bound). */
  complete: boolean;
  events: number;
  pricedEvents: number;
  /** Successful events with no configured price. */
  unpricedEvents: number;
  /** Failed calls: their cost is unknown. */
  failedEvents: number;
  /** Priced from estimated token counts (the provider reported no usage). */
  estimatedTokenEvents: number;
  /** Priced in a currency with no configured exchange rate. */
  unconvertibleEvents: number;
  tokens: { in: number; cachedIn: number; out: number };
}

export function summarizeCosts(rows: UsageRow[]): CostSummary {
  const s: CostSummary = { eurMicros: 0, complete: true, events: rows.length, pricedEvents: 0, unpricedEvents: 0, failedEvents: 0, estimatedTokenEvents: 0, unconvertibleEvents: 0, tokens: { in: 0, cachedIn: 0, out: 0 } };
  // Summed per currency and converted once, so rounding doesn't accumulate per event.
  const byCurrency = new Map<string, { micros: number; events: number }>();
  for (const r of rows) {
    if (r.kind === "llm") {
      s.tokens.in += r.tokensIn;
      s.tokens.cachedIn += r.cachedTokensIn ?? 0;
      s.tokens.out += r.tokensOut;
    }
    if (!r.ok) {
      s.failedEvents++;
      continue;
    }
    // Free tools (Wikipedia, page fetches) and e-mail have no variable cost to price.
    if (r.costMicros == null) {
      if (r.kind === "llm" || r.kind === "search") s.unpricedEvents++;
      continue;
    }
    s.pricedEvents++;
    if (r.estimated) s.estimatedTokenEvents++;
    const c = byCurrency.get(r.costCurrency ?? "USD") ?? { micros: 0, events: 0 };
    c.micros += r.costMicros;
    c.events++;
    byCurrency.set(r.costCurrency ?? "USD", c);
  }
  for (const [currency, c] of byCurrency) {
    const eur = toEurMicros({ micros: c.micros, currency });
    if (eur == null) s.unconvertibleEvents += c.events;
    else s.eurMicros += eur;
  }
  s.complete = s.unpricedEvents === 0 && s.failedEvents === 0 && s.unconvertibleEvents === 0;
  return s;
}

/** Free, keyless search providers have no per-call cost. */
const FREE_SEARCH = new Set(["wikipedia"]);

function costRowsWhere(where: object) {
  return prisma.usageEvent.findMany({
    where,
    select: { kind: true, provider: true, ok: true, estimated: true, tokensIn: true, tokensOut: true, cachedTokensIn: true, costMicros: true, costCurrency: true },
  });
}

/** Rows that can carry a variable cost: model calls and paid search. */
function billable<T extends { kind: string; provider: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.kind === "llm" || (r.kind === "search" && !FREE_SEARCH.has(r.provider)));
}

function marginOf(creditValueCents: number, cost: CostSummary) {
  const costCents = cost.eurMicros / 10_000;
  const contributionEurCents = cost.complete ? Math.round((creditValueCents - costCents) * 100) / 100 : null;
  const grossMarginPct = cost.complete && creditValueCents > 0 ? Math.round(((creditValueCents - costCents) / creditValueCents) * 1000) / 10 : null;
  return { contributionEurCents, grossMarginPct };
}

export async function executionEconomics(executionId: string, targetMargin = 0.75) {
  const ex = await prisma.execution.findUnique({
    where: { id: executionId },
    select: { id: true, objectiveId: true, status: true, estimatedCostCents: true, costCents: true, refundedCents: true, createdAt: true, completedAt: true },
  });
  if (!ex) return null;
  const rows = billable(await costRowsWhere({ executionId }));
  const net = Math.max(0, ex.costCents - ex.refundedCents);
  const creditValue = creditValueEurCents(net);
  const cost = summarizeCosts(rows);
  return {
    executionId: ex.id,
    objectiveId: ex.objectiveId,
    status: ex.status,
    createdAt: ex.createdAt.toISOString(),
    completedAt: ex.completedAt?.toISOString() ?? null,
    credits: { estimated: ex.estimatedCostCents, charged: ex.costCents, refunded: ex.refundedCents, net },
    creditValueEurCents: Math.round(creditValue * 100) / 100,
    creditValueNote: "List-price value of the net credits consumed at CREDITS_PER_EUR; demo and trial credits are not revenue.",
    variableCost: cost,
    ...marginOf(creditValue, cost),
    targetMargin,
    suggestedCreditsAtTargetMargin: cost.complete ? suggestedCredits(cost.eurMicros, targetMargin, { roundTo: 10, minimum: 10 }) : null,
    excludedCosts: EXCLUDED_COSTS,
  };
}

/** Aggregate over executions created in the last `days` days. */
export async function economicsSummary(days = 30, targetMargin = 0.75) {
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const executions = await prisma.execution.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, status: true, costCents: true, refundedCents: true },
  });
  const ids = executions.map((e) => e.id);
  const rows = ids.length ? billable(await costRowsWhere({ executionId: { in: ids } })) : [];
  // Model calls outside executions (objective suggestions, legacy reports) are overhead, reported apart.
  const overheadRows = billable(await costRowsWhere({ executionId: null, createdAt: { gte: since } }));
  const completed = executions.filter((e) => e.status === "COMPLETED").length;
  const charged = executions.reduce((n, e) => n + e.costCents, 0);
  const refunded = executions.reduce((n, e) => n + e.refundedCents, 0);
  const net = Math.max(0, charged - refunded);
  const creditValue = creditValueEurCents(net);
  const cost = summarizeCosts(rows);
  const overhead = summarizeCosts(overheadRows);
  const { table, problem } = pricingTable();
  return {
    days,
    since: since.toISOString(),
    executions: {
      total: executions.length,
      completed,
      failed: executions.filter((e) => e.status === "FAILED").length,
      cancelled: executions.filter((e) => e.status === "CANCELLED").length,
    },
    credits: { charged, refunded, net, perCompletedExecution: completed ? Math.round(net / completed) : null },
    creditsPerEur: config.creditsPerEur,
    creditValueEurCents: Math.round(creditValue * 100) / 100,
    creditValueNote: "List-price value of the net credits consumed; demo and trial credits are not revenue.",
    variableCost: cost,
    overheadCost: overhead,
    /** Variable cost of ALL executions in the period divided by the successful ones (failed work is part of the price of success). */
    costPerCompletedExecutionEurMicros: completed && cost.complete ? Math.round(cost.eurMicros / completed) : null,
    ...marginOf(creditValue, cost),
    targetMargin,
    pricing: {
      configuredModels: Object.keys(table.models),
      configuredTools: Object.keys(table.tools),
      fxCurrencies: Object.keys(table.fx),
      problem,
    },
    excludedCosts: EXCLUDED_COSTS,
  };
}
