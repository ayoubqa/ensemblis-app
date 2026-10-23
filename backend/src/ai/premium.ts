// Optional premium model route (e.g. OpenAI GPT-5.5) for main-tier model calls,
// with the standard OpenAI-compatible endpoint (OPENAI_BASE_URL / OPENAI_MODEL —
// Groq gpt-oss-120b in render.yaml) as the fallback that keeps working when the
// premium route is off, over budget or failing. Server-side configuration only:
//
//   PREMIUM_MODEL             model id at the premium endpoint (unset = route off)
//   PREMIUM_API_KEY           its API key (secret; unset = route off)
//   PREMIUM_BASE_URL          default https://api.openai.com/v1
//   PREMIUM_REASONING_EFFORT  none | low | medium | high | xhigh (default low)
//   PREMIUM_MAX_TOKENS        output cap per call (default: the call's own cap)
//   PREMIUM_PURPOSES          comma list of call purposes it serves (default plan,step,verify)
//   PREMIUM_DAILY_BUDGET_EUR  premium spend per UTC day, from priced usage (default 2; 0 = off)
//
// The route is used only while its model has a price in PROVIDER_PRICING (the
// daily budget can't be enforced otherwise), and is paused for a while after a
// configuration, quota or rate-limit error. Only AI_PROVIDER=openai uses it.

import { prisma } from "../db";
import { priceModelCall, toEurMicros, type PricedCost } from "../billing/pricing";
import { startOfTodayUTC } from "../lib/usage";
import { classifyProviderError, type ProviderErrorKind } from "./errors";
import type { LLMPurpose } from "./llmProvider";

export const DEFAULT_PREMIUM_BASE_URL = "https://api.openai.com/v1";
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);
const DEFAULT_PURPOSES: LLMPurpose[] = ["plan", "step", "verify"];
const DEFAULT_DAILY_BUDGET_EUR = 2;
/** How long the route stays off after an error that a retry won't fix soon. */
export const PREMIUM_COOLDOWN_MS: Partial<Record<ProviderErrorKind, number>> = { config: 15 * 60_000, quota: 15 * 60_000, rate_limit: 60_000 };

export interface PremiumSettings {
  model: string;
  apiKey: string;
  baseUrl: string;
  reasoningEffort: string;
  maxTokens: number | null;
  purposes: Set<string>;
  dailyBudgetEur: number;
}

/** The configured premium route, or null when it is not configured (no model or no key). */
export function premiumSettings(): PremiumSettings | null {
  const model = process.env.PREMIUM_MODEL?.trim();
  const apiKey = process.env.PREMIUM_API_KEY?.trim();
  if (!model || !apiKey) return null;
  const effort = (process.env.PREMIUM_REASONING_EFFORT || "low").trim().toLowerCase();
  const maxTokens = Number(process.env.PREMIUM_MAX_TOKENS);
  const budget = Number(process.env.PREMIUM_DAILY_BUDGET_EUR);
  const purposes = (process.env.PREMIUM_PURPOSES || "").split(",").map((p) => p.trim()).filter(Boolean);
  return {
    model,
    apiKey,
    baseUrl: (process.env.PREMIUM_BASE_URL || DEFAULT_PREMIUM_BASE_URL).trim().replace(/\/+$/, ""),
    reasoningEffort: EFFORTS.has(effort) ? effort : "low",
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : null,
    purposes: new Set(purposes.length ? purposes : DEFAULT_PURPOSES),
    dailyBudgetEur: process.env.PREMIUM_DAILY_BUDGET_EUR?.trim() && Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_DAILY_BUDGET_EUR,
  };
}

/** Configuration warnings for boot logs (config.ts productionConfigWarnings). No secrets. */
export function premiumConfigWarnings(): string[] {
  const model = process.env.PREMIUM_MODEL?.trim();
  if (!model) return [];
  const out: string[] = [];
  if ((process.env.AI_PROVIDER || "").trim().toLowerCase() !== "openai") out.push(`PREMIUM_MODEL=${model} is ignored: the premium route needs AI_PROVIDER=openai.`);
  if (!process.env.PREMIUM_API_KEY?.trim()) out.push(`PREMIUM_MODEL=${model} is set but PREMIUM_API_KEY is not: every call uses the standard model.`);
  const effort = process.env.PREMIUM_REASONING_EFFORT?.trim().toLowerCase();
  if (effort && !EFFORTS.has(effort)) out.push(`PREMIUM_REASONING_EFFORT="${effort}" is not one of ${[...EFFORTS].join(", ")}; using "low".`);
  if (!priceModelCall({ provider: "openai", model, tokensIn: 1, tokensOut: 1 })) out.push(`PREMIUM_MODEL=${model} has no price in PROVIDER_PRICING: the premium route stays off (its daily budget can't be enforced).`);
  return out;
}

// ---------------------------------------------------------------- state (per process)

let pausedUntil = 0;
let pausedReason: string | null = null;
/** Today's premium spend in EUR micros: read from usage events, then kept current in memory. */
let spend: { day: number; model: string; eurMicros: number; readAt: number } | null = null;
const SPEND_REFRESH_MS = 60_000;

/** Tests only. */
export function resetPremiumStateForTests(): void {
  pausedUntil = 0;
  pausedReason = null;
  spend = null;
}

async function spentTodayEurMicros(model: string, now = Date.now()): Promise<number> {
  const day = startOfTodayUTC(new Date(now)).getTime();
  if (spend && spend.day === day && spend.model === model && now - spend.readAt < SPEND_REFRESH_MS) return spend.eurMicros;
  const rows = await prisma.usageEvent.groupBy({
    by: ["costCurrency"],
    where: { kind: "llm", model, createdAt: { gte: new Date(day) }, costMicros: { not: null } },
    _sum: { costMicros: true },
  });
  let eurMicros = 0;
  for (const r of rows) eurMicros += toEurMicros({ micros: r._sum.costMicros ?? 0, currency: r.costCurrency ?? "USD" }) ?? 0;
  spend = { day, model, eurMicros, readAt: now };
  return eurMicros;
}

/** Adds a just-finished premium call to today's spend (the usage row is written asynchronously). */
export function notePremiumSpend(model: string, cost: PricedCost | null): void {
  if (!cost || !spend || spend.model !== model) return;
  spend.eurMicros += toEurMicros(cost) ?? 0;
}

export type PremiumDecision = { use: true; settings: PremiumSettings } | { use: false; reason: string };

/** Whether this call goes to the premium route, and why not when it doesn't. */
export async function premiumRouteFor(purpose: LLMPurpose | undefined, tier: "main" | "fast", now = Date.now()): Promise<PremiumDecision> {
  if ((process.env.AI_PROVIDER || "").trim().toLowerCase() !== "openai") return { use: false, reason: "provider" };
  const s = premiumSettings();
  if (!s) return { use: false, reason: "not configured" };
  if (tier !== "main") return { use: false, reason: "fast tier" };
  if (!s.purposes.has(purpose ?? "other")) return { use: false, reason: "purpose" };
  if (now < pausedUntil) return { use: false, reason: `paused (${pausedReason})` };
  if (!priceModelCall({ provider: "openai", model: s.model, tokensIn: 1, tokensOut: 1 })) return { use: false, reason: "unpriced" };
  if (s.dailyBudgetEur <= 0) return { use: false, reason: "budget 0" };
  const spent = await spentTodayEurMicros(s.model, now).catch(() => Infinity);
  if (spent >= s.dailyBudgetEur * 1_000_000) return { use: false, reason: "daily budget reached" };
  return { use: true, settings: s };
}

/**
 * After a premium call failed before any output reached the caller: whether to
 * retry on the standard route (everything except a request too large for any
 * model), pausing the premium route when the error won't clear soon.
 */
export function onPremiumFailure(err: unknown, now = Date.now()): { fallBack: boolean; kind: ProviderErrorKind } {
  const kind = classifyProviderError(err);
  const pause = PREMIUM_COOLDOWN_MS[kind];
  if (pause) {
    pausedUntil = now + pause;
    pausedReason = kind;
  }
  return { fallBack: kind !== "too_large", kind };
}

/** For the owner dashboard: what the premium route is doing right now (no secrets). */
export async function premiumStatus(now = Date.now()) {
  const s = premiumSettings();
  if (!process.env.PREMIUM_MODEL?.trim()) return { configured: false as const };
  return {
    configured: !!s,
    model: process.env.PREMIUM_MODEL.trim(),
    priced: !!priceModelCall({ provider: "openai", model: process.env.PREMIUM_MODEL.trim(), tokensIn: 1, tokensOut: 1 }),
    pausedFor: now < pausedUntil ? pausedReason : null,
    dailyBudgetEur: s?.dailyBudgetEur ?? null,
    spentTodayEurMicros: s ? await spentTodayEurMicros(s.model, now).catch(() => null) : null,
    purposes: s ? [...s.purposes] : [],
  };
}
