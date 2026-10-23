// Internal unit economics (owner dashboard / operators only; never customers).
//
//   variable contribution = credit value consumed − variable API/tool cost
//   variable margin       = variable contribution / credit value consumed
//
// None of these figures is net profit, and the report says so in every
// response (NOT_NET_PROFIT):
// - Credit value is the euro value of the NET credits consumed (charged −
//   refunded) at CREDITS_PER_EUR. Demo, trial and starting credits are not
//   revenue, so this is a list-price value. Cash actually collected (completed
//   Stripe purchases) is reported apart.
// - Variable cost is split into MEASURED (provider-reported token counts at the
//   configured list price) and ESTIMATED (our own token estimate when the
//   provider reported none). It is not the provider's invoice: free-tier
//   allowances, batch/cache billing quirks and taxes are not modelled.
// - Fixed hosting/database plans and payment fees are included only when
//   configured in PROVIDER_PRICING; otherwise they are "not configured" (null),
//   never zero.
// - Never included: taxes, labour, refunds of real money.
// Events without a configured price, failed calls (cost unknown) and events in
// a currency without an exchange rate are counted, not guessed, and make the
// figure "incomplete".

import { prisma } from "../db";
import { config } from "../config";
import { creditValueEurCents } from "./credits";
import { pricingStatus, pricingTable, suggestedCredits, toEurMicros } from "./pricing";

export const NOT_NET_PROFIT =
  "Not net profit: credit value is list price (demo and trial credits are not revenue), variable cost is priced from token counts at list price, and taxes and labour are never included.";

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
  /** Sum of every priced, convertible event, in millionths of EUR (measured + estimated). */
  eurMicros: number;
  /** Priced from provider-reported token counts. */
  measuredEurMicros: number;
  /** Priced from our own token estimate (the provider reported no usage). */
  estimatedEurMicros: number;
  /** True when every event has a known cost in EUR (otherwise eurMicros is a lower bound). */
  complete: boolean;
  events: number;
  pricedEvents: number;
  /** Successful events with no configured price. */
  unpricedEvents: number;
  /** Failed calls: their cost is unknown. */
  failedEvents: number;
  /** Priced from estimated token counts. */
  estimatedTokenEvents: number;
  /** Priced in a currency with no configured exchange rate. */
  unconvertibleEvents: number;
  tokens: { in: number; cachedIn: number; out: number };
}

export function summarizeCosts(rows: UsageRow[]): CostSummary {
  const s: CostSummary = {
    eurMicros: 0,
    measuredEurMicros: 0,
    estimatedEurMicros: 0,
    complete: true,
    events: rows.length,
    pricedEvents: 0,
    unpricedEvents: 0,
    failedEvents: 0,
    estimatedTokenEvents: 0,
    unconvertibleEvents: 0,
    tokens: { in: 0, cachedIn: 0, out: 0 },
  };
  // Summed per (currency, measured|estimated) and converted once, so rounding doesn't accumulate per event.
  const buckets = new Map<string, { currency: string; estimated: boolean; micros: number; events: number }>();
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
    const estimated = !!r.estimated;
    if (estimated) s.estimatedTokenEvents++;
    const currency = r.costCurrency ?? "USD";
    const key = `${currency}|${estimated ? "e" : "m"}`;
    const b = buckets.get(key) ?? { currency, estimated, micros: 0, events: 0 };
    b.micros += r.costMicros;
    b.events++;
    buckets.set(key, b);
  }
  for (const b of buckets.values()) {
    const eur = toEurMicros({ micros: b.micros, currency: b.currency });
    if (eur == null) s.unconvertibleEvents += b.events;
    else if (b.estimated) s.estimatedEurMicros += eur;
    else s.measuredEurMicros += eur;
  }
  s.eurMicros = s.measuredEurMicros + s.estimatedEurMicros;
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

const cents2 = (n: number) => Math.round(n * 100) / 100;

/** Credit value consumed minus variable cost; null while the cost is incomplete. */
function variableMargin(creditValueCents: number, cost: CostSummary) {
  const costCents = cost.eurMicros / 10_000;
  return {
    variableContributionEurCents: cost.complete ? cents2(creditValueCents - costCents) : null,
    variableMarginPct: cost.complete && creditValueCents > 0 ? Math.round(((creditValueCents - costCents) / creditValueCents) * 1000) / 10 : null,
  };
}

/** Fixed plans allocated pro rata to `days`; null when not configured. */
export function fixedCostsFor(days: number): { eurCents: number | null; items: Record<string, number> } {
  const monthly = pricingTable().table.fixedMonthlyEur;
  if (!monthly) return { eurCents: null, items: {} };
  const items = Object.fromEntries(Object.entries(monthly).map(([k, eur]) => [k, cents2((eur * 100 * days) / 30)]));
  return { eurCents: cents2(Object.values(items).reduce((n, v) => n + v, 0)), items };
}

/** Real money collected (completed Stripe purchases) and its processing fees since `since`. */
async function cashFor(since: Date) {
  const paid = await prisma.stripePayment.findMany({ where: { status: "completed", completedAt: { gte: since } }, select: { amountCents: true } });
  const fees = pricingTable().table.paymentFees;
  const collectedEurCents = paid.reduce((n, p) => n + p.amountCents, 0);
  // No purchases means no fees — a fact, not a guess. With purchases, fees are known only when configured.
  const paymentFeesEurCents = paid.length === 0 ? 0 : fees ? cents2(paid.reduce((n, p) => n + (p.amountCents * fees.percent) / 100 + fees.fixedEurCents, 0)) : null;
  return { purchases: paid.length, collectedEurCents, paymentFeesEurCents };
}

function excludedCosts(fixed: "included" | "not configured" | "not allocated per execution", fees: "included" | "not configured" | "not allocated per execution"): string[] {
  return [
    ...(fixed === "included" ? [] : [`fixed hosting and database plans (${fixed})`]),
    ...(fees === "included" ? [] : [`payment processing fees (${fees})`]),
    "provider free-tier allowances and invoice adjustments",
    "taxes",
    "labour",
  ];
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
    creditValueEurCents: cents2(creditValue),
    creditValueNote: "List-price value of the net credits consumed at CREDITS_PER_EUR; demo and trial credits are not revenue.",
    variableCost: cost,
    ...variableMargin(creditValue, cost),
    targetMargin,
    /** Credits that would cover this execution's variable cost at the target margin. A price floor, not a profit figure. */
    suggestedCreditsAtTargetMargin: cost.complete ? suggestedCredits(cost.eurMicros, targetMargin, { roundTo: 10, minimum: 10 }) : null,
    suggestedCreditsNote: "Covers variable API/tool cost at the target margin only; fixed costs and fees are not in it.",
    notNetProfit: NOT_NET_PROFIT,
    excludedCosts: excludedCosts("not allocated per execution", "not allocated per execution"),
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
  const fixed = fixedCostsFor(days);
  const cash = await cashFor(since);
  const pricing = pricingStatus();

  // After every cost category: known only when each one is.
  const allKnown = cost.complete && overhead.complete && fixed.eurCents != null && cash.paymentFeesEurCents != null;
  const operatingContributionEurCents = allKnown
    ? cents2(creditValue - cost.eurMicros / 10_000 - overhead.eurMicros / 10_000 - (fixed.eurCents ?? 0) - (cash.paymentFeesEurCents ?? 0))
    : null;

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
    creditValueEurCents: cents2(creditValue),
    creditValueNote: "List-price value of the net credits consumed; demo and trial credits are not revenue.",
    /** Real money: completed credit-pack purchases in the period (not matched to the credits consumed). */
    cash: { purchases: cash.purchases, collectedEurCents: cash.collectedEurCents },
    variableCost: cost,
    overheadCost: overhead,
    fixedCost: fixed,
    paymentFeesEurCents: cash.paymentFeesEurCents,
    /** Variable cost of ALL executions in the period divided by the successful ones (failed work is part of the price of success). */
    costPerCompletedExecutionEurMicros: completed && cost.complete ? Math.round(cost.eurMicros / completed) : null,
    ...variableMargin(creditValue, cost),
    /** Credit value minus variable, overhead, fixed costs and fees; null unless every category is known. Still not net profit. */
    operatingContributionEurCents,
    targetMargin,
    notNetProfit: NOT_NET_PROFIT,
    pricing,
    excludedCosts: excludedCosts(fixed.eurCents != null ? "included" : "not configured", cash.paymentFeesEurCents != null ? "included" : "not configured"),
  };
}
