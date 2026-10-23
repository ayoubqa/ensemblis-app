// Provider and tool prices for INTERNAL cost accounting, and the pricing maths.
// Nothing here is sent to the browser.
//
// Prices are configured, never guessed. PROVIDER_PRICING (server-side JSON)
// lists what each model costs per million tokens, and each paid tool per call,
// in the provider's currency, plus euro exchange rates:
//
//   {"models": {"openai/gpt-oss-120b": {"inputPerMTok": 0.15, "cachedInputPerMTok": 0.075, "outputPerMTok": 0.60, "currency": "USD"}},
//    "tools":  {"search:tavily": {"perCall": 0.008, "currency": "USD"}},
//    "fx":     {"USD": 0.92}}          <- 1 USD = 0.92 EUR
//
// A model key may be "<provider>:<model>" or just "<model>". An event whose
// model or tool has no configured price gets no cost (null) — reported as
// "unpriced", never estimated from a default. Prices change: keep the JSON in
// the deployment's environment, not in code.

import { z } from "zod";
import { config } from "../config";

const Currency = z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO code");
const ModelPrice = z.object({
  inputPerMTok: z.number().nonnegative(),
  /** Price of cached input tokens; defaults to inputPerMTok when the provider has no cache discount. */
  cachedInputPerMTok: z.number().nonnegative().optional(),
  outputPerMTok: z.number().nonnegative(),
  currency: Currency.default("USD"),
});
const ToolPrice = z.object({ perCall: z.number().nonnegative(), currency: Currency.default("USD") });
const PricingSchema = z.object({
  models: z.record(ModelPrice).default({}),
  tools: z.record(ToolPrice).default({}),
  /** EUR per 1 unit of each currency. EUR itself is implicit (1). */
  fx: z.record(z.number().positive()).default({}),
});
export type PricingTable = z.infer<typeof PricingSchema>;

let cached: { raw: string | undefined; table: PricingTable; problem: string | null } | null = null;

/** The configured price table (empty when PROVIDER_PRICING is unset or invalid — invalid is reported, never half-applied). */
export function pricingTable(): { table: PricingTable; problem: string | null } {
  const raw = process.env.PROVIDER_PRICING;
  if (cached && cached.raw === raw) return cached;
  let table: PricingTable = { models: {}, tools: {}, fx: {} };
  let problem: string | null = null;
  if (raw && raw.trim()) {
    try {
      const parsed = PricingSchema.safeParse(JSON.parse(raw));
      if (parsed.success) table = parsed.data;
      else problem = `PROVIDER_PRICING is invalid (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}); costs are left unpriced.`;
    } catch {
      problem = "PROVIDER_PRICING is not valid JSON; costs are left unpriced.";
    }
  }
  cached = { raw, table, problem };
  return cached;
}

export interface PricedCost {
  /** Millionths of `currency`. */
  micros: number;
  currency: string;
}

/** Cost of one model call from its token counts, or null when the model has no configured price. */
export function priceModelCall(args: { provider: string; model: string | null | undefined; tokensIn: number; cachedTokensIn?: number | null; tokensOut: number }): PricedCost | null {
  if (!args.model) return null;
  const { table } = pricingTable();
  const price = table.models[`${args.provider}:${args.model}`] ?? table.models[args.model];
  if (!price) return null;
  const cachedIn = Math.min(Math.max(0, args.cachedTokensIn ?? 0), Math.max(0, args.tokensIn));
  const uncachedIn = Math.max(0, args.tokensIn) - cachedIn;
  // Price per million tokens x tokens = millionths of the currency.
  const micros = uncachedIn * price.inputPerMTok + cachedIn * (price.cachedInputPerMTok ?? price.inputPerMTok) + Math.max(0, args.tokensOut) * price.outputPerMTok;
  return { micros: Math.round(micros), currency: price.currency };
}

/** Cost of one paid tool call ("search:tavily"), or null when it has no configured price. */
export function priceToolCall(key: string): PricedCost | null {
  const price = pricingTable().table.tools[key];
  return price ? { micros: Math.round(price.perCall * 1_000_000), currency: price.currency } : null;
}

/** Millionths of EUR, or null when the currency has no configured exchange rate. */
export function toEurMicros(cost: PricedCost): number | null {
  if (cost.currency === "EUR") return cost.micros;
  const rate = pricingTable().table.fx[cost.currency];
  return rate ? Math.round(cost.micros * rate) : null;
}

// ---------------------------------------------------------------- pricing maths

/**
 * Revenue needed for `margin` gross margin on variable cost `cost`:
 * revenue = cost / (1 − margin). Same unit in and out.
 */
export function requiredRevenue(cost: number, margin: number): number {
  if (!(margin >= 0 && margin < 1)) throw new RangeError("margin must be in [0, 1)");
  if (!(cost >= 0)) throw new RangeError("cost must be >= 0");
  return cost / (1 - margin);
}

/** Euro cents -> credits at CREDITS_PER_EUR, rounded UP to `roundTo` and at least `minimum`. */
export function creditsForEurCents(eurCents: number, opts: { roundTo?: number; minimum?: number; creditsPerEur?: number } = {}): number {
  const roundTo = Math.max(1, Math.floor(opts.roundTo ?? 10));
  const perEur = opts.creditsPerEur ?? config.creditsPerEur;
  const raw = (Math.max(0, eurCents) / 100) * perEur;
  return Math.max(opts.minimum ?? 0, Math.ceil(raw / roundTo - 1e-9) * roundTo);
}

/** Credits to charge for variable cost `costEurMicros` at `margin` gross margin (rounded up; see creditsForEurCents). */
export function suggestedCredits(costEurMicros: number, margin: number, opts: { roundTo?: number; minimum?: number } = {}): number {
  const revenueEurCents = requiredRevenue(costEurMicros, margin) / 10_000; // micros -> cents
  return creditsForEurCents(revenueEurCents, opts);
}
