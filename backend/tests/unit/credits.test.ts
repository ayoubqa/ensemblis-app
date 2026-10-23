import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { creditValueEurCents, formatCredits, legacyEurToCredits, legacyEurToCreditsBeforeQuote } from "../../src/billing/credits";
import {
  creditsForEurCents,
  priceModelCall,
  priceToolCall,
  pricingStatus,
  pricingTable,
  requiredRevenue,
  suggestedCredits,
  toEurMicros,
} from "../../src/billing/pricing";
import { fixedCostsFor, summarizeCosts } from "../../src/billing/economics";

describe("credits", () => {
  it("formats whole credits for customers", () => {
    expect(formatCredits(1150)).toBe("1,150 credits");
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(0)).toBe("0 credits");
    expect(formatCredits(-50)).toBe("−50 credits");
    expect(formatCredits(1_000_000)).toBe("1,000,000 credits");
  });

  it("values credits internally at CREDITS_PER_EUR (100 by default: 1 credit = €0.01)", () => {
    expect(config.creditsPerEur).toBe(100);
    expect(creditValueEurCents(1150)).toBe(1150);
    const before = config.creditsPerEur;
    config.creditsPerEur = 200;
    try {
      expect(creditValueEurCents(1150)).toBe(575);
    } finally {
      config.creditsPerEur = before;
    }
  });

  it("converts the server's former euro format exactly, and nothing else", () => {
    expect(legacyEurToCredits("€11.50 charged to the organization's balance")).toBe("1,150 credits charged to the organization's balance");
    expect(legacyEurToCredits("The estimated cost (€0.05) is above (€1234.00).")).toBe("The estimated cost (5 credits) is above (123,400 credits).");
    // Shapes the server never wrote (model or user text) stay as they are.
    for (const s of ["€4.5bn market", "€20–€40 per seat", "€9 per payslip", "€1,200.00 total", "€12.345"]) expect(legacyEurToCredits(s)).toBe(s);
  });

  it("leaves quoted user text alone", () => {
    expect(legacyEurToCreditsBeforeQuote("Approve €11.50 for “Cut CAC below €20.00”")).toBe("Approve 1,150 credits for “Cut CAC below €20.00”");
    expect(legacyEurToCreditsBeforeQuote("Plan ready: 4 steps · estimated €11.50")).toBe("Plan ready: 4 steps · estimated 1,150 credits");
  });
});

describe("pricing", () => {
  const PRICES = {
    models: {
      "openai/gpt-oss-120b": { inputPerMTok: 0.15, cachedInputPerMTok: 0.075, outputPerMTok: 0.6, currency: "USD" },
      "anthropic:claude-x": { inputPerMTok: 3, outputPerMTok: 15, currency: "USD" },
      "claude-x": { inputPerMTok: 999, outputPerMTok: 999, currency: "USD" },
    },
    tools: { "search:tavily": { perCall: 0.008, currency: "USD" } },
    fx: { USD: 0.9 },
  };
  afterEach(() => {
    delete process.env.PROVIDER_PRICING;
  });

  it("prices nothing when no price table is configured (never a guessed default)", () => {
    expect(pricingTable().problem).toBeNull();
    expect(priceModelCall({ provider: "openai", model: "openai/gpt-oss-120b", tokensIn: 1000, tokensOut: 1000 })).toBeNull();
    expect(priceToolCall("search:tavily")).toBeNull();
  });

  it("an invalid table is reported and ignored as a whole", () => {
    process.env.PROVIDER_PRICING = JSON.stringify({ models: { m: { inputPerMTok: -1, outputPerMTok: 1 } } });
    expect(pricingTable().problem).toMatch(/PROVIDER_PRICING is invalid/);
    expect(priceModelCall({ provider: "openai", model: "m", tokensIn: 10, tokensOut: 10 })).toBeNull();
    process.env.PROVIDER_PRICING = "{not json";
    expect(pricingTable().problem).toMatch(/not valid JSON/);
  });

  it("computes model cost from tokens, with the cache discount and provider-specific keys first", () => {
    process.env.PROVIDER_PRICING = JSON.stringify(PRICES);
    // 6000 uncached in x 0.15 + 4000 cached x 0.075 + 2000 out x 0.60 = 900 + 300 + 1200 micros (USD)
    expect(priceModelCall({ provider: "openai", model: "openai/gpt-oss-120b", tokensIn: 10_000, cachedTokensIn: 4000, tokensOut: 2000 })).toEqual({ micros: 2400, currency: "USD" });
    expect(priceModelCall({ provider: "anthropic", model: "claude-x", tokensIn: 1000, tokensOut: 1000 })).toEqual({ micros: 18_000, currency: "USD" });
    expect(priceModelCall({ provider: "openai", model: "unknown-model", tokensIn: 1000, tokensOut: 1000 })).toBeNull();
    expect(priceToolCall("search:tavily")).toEqual({ micros: 8000, currency: "USD" });
    expect(toEurMicros({ micros: 2400, currency: "USD" })).toBe(2160);
    expect(toEurMicros({ micros: 2400, currency: "EUR" })).toBe(2400);
    expect(toEurMicros({ micros: 2400, currency: "GBP" })).toBeNull();
  });

  it("required revenue for a target gross margin is C / (1 − M)", () => {
    expect(requiredRevenue(25, 0.75)).toBe(100);
    expect(requiredRevenue(30, 0.7)).toBeCloseTo(100, 10);
    expect(requiredRevenue(0, 0.8)).toBe(0);
    expect(() => requiredRevenue(10, 1)).toThrow(RangeError);
    expect(() => requiredRevenue(-1, 0.5)).toThrow(RangeError);
  });

  it("converts revenue to credits, rounding up, with a minimum", () => {
    expect(creditsForEurCents(1234)).toBe(1240); // €12.34 -> 1,234 credits -> rounded up to 10
    expect(creditsForEurCents(1234, { roundTo: 1 })).toBe(1234);
    expect(creditsForEurCents(1, { minimum: 50 })).toBe(50);
    expect(creditsForEurCents(1000, { creditsPerEur: 50 })).toBe(500);
    // Variable cost €0.02 (20,000 micros) at 75% margin needs €0.08 -> 8 credits -> 10 after rounding.
    expect(suggestedCredits(20_000, 0.75)).toBe(10);
    expect(suggestedCredits(2_000_000, 0.8, { roundTo: 50 })).toBe(1000);
  });

  it("cost summaries count unpriced, failed, estimated and unconvertible events instead of guessing", () => {
    process.env.PROVIDER_PRICING = JSON.stringify(PRICES);
    const row = (o: Partial<Parameters<typeof summarizeCosts>[0][number]>) => ({ kind: "llm", ok: true, estimated: false, tokensIn: 100, tokensOut: 50, cachedTokensIn: null, costMicros: null, costCurrency: null, ...o });
    const all = summarizeCosts([row({ costMicros: 1000, costCurrency: "USD" }), row({ costMicros: 500, costCurrency: "EUR", estimated: true })]);
    expect(all).toMatchObject({ eurMicros: 1400, measuredEurMicros: 900, estimatedEurMicros: 500, complete: true, pricedEvents: 2, estimatedTokenEvents: 1, tokens: { in: 200, out: 100 } });
    const partial = summarizeCosts([row({ costMicros: 1000, costCurrency: "USD" }), row({}), row({ ok: false }), row({ costMicros: 10, costCurrency: "GBP" })]);
    expect(partial).toMatchObject({ eurMicros: 900, complete: false, unpricedEvents: 1, failedEvents: 1, unconvertibleEvents: 1 });
  });

  it("reports when prices were checked, and flags them once they are stale", () => {
    expect(pricingStatus()).toMatchObject({ asOf: null, ageDays: null, stale: false, fixedCostsConfigured: false, paymentFeesConfigured: false });
    process.env.PROVIDER_PRICING = JSON.stringify({ ...PRICES, asOf: "2026-01-01", sources: ["https://example.com/prices"] });
    expect(pricingStatus(new Date("2026-02-01T00:00:00Z"))).toMatchObject({ asOf: "2026-01-01", ageDays: 31, stale: false, sources: ["https://example.com/prices"] });
    expect(pricingStatus(new Date("2026-06-01T00:00:00Z"))).toMatchObject({ ageDays: 151, stale: true });
    process.env.PROVIDER_PRICING = JSON.stringify({ ...PRICES, asOf: "1 Jan 2026" });
    expect(pricingStatus().problem).toMatch(/asOf must be YYYY-MM-DD/);
  });

  it("fixed plans are unknown until configured, then allocated pro rata", () => {
    expect(fixedCostsFor(30)).toEqual({ eurCents: null, items: {} });
    process.env.PROVIDER_PRICING = JSON.stringify({ ...PRICES, fixedMonthlyEur: { render: 7, neon: 0 } });
    expect(fixedCostsFor(30)).toEqual({ eurCents: 700, items: { render: 700, neon: 0 } });
    expect(fixedCostsFor(15)).toEqual({ eurCents: 350, items: { render: 350, neon: 0 } });
  });
});

describe("the deployed price table (render.yaml)", () => {
  const yaml = readFileSync(join(__dirname, "../../../render.yaml"), "utf8");
  const raw = /- key: PROVIDER_PRICING\n\s+value: '([^']+)'/.exec(yaml)?.[1];
  afterEach(() => {
    delete process.env.PROVIDER_PRICING;
  });

  it("is valid, dated, sourced, and prices the configured models and paid search", () => {
    expect(raw).toBeTruthy();
    process.env.PROVIDER_PRICING = raw;
    const status = pricingStatus(new Date("2026-10-23T12:00:00Z"));
    expect(status.problem).toBeNull();
    expect(status.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(status.sources.length).toBeGreaterThan(0);
    const model = /- key: OPENAI_MODEL\n\s+value: (\S+)/.exec(yaml)?.[1];
    const fast = /- key: OPENAI_FAST_MODEL\n\s+value: (\S+)/.exec(yaml)?.[1];
    for (const m of [model, fast]) expect(priceModelCall({ provider: "openai", model: m, tokensIn: 1000, tokensOut: 1000 })).not.toBeNull();
    expect(priceToolCall("search:tavily")).not.toBeNull();
    // Every priced currency converts to EUR.
    const t = pricingTable().table;
    for (const p of [...Object.values(t.models), ...Object.values(t.tools)]) expect(toEurMicros({ micros: 1, currency: p.currency })).not.toBeNull();
    // Unknown costs stay unknown rather than zero.
    expect(status).toMatchObject({ fixedCostsConfigured: false, paymentFeesConfigured: false });
  });
});
