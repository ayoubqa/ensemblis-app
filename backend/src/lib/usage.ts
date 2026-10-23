// Metering for the owner dashboard, budget guards and internal cost
// accounting (billing/economics.ts). Never throws: metering must not break a task.

import { prisma } from "../db";
import { redact } from "./log";
import { priceModelCall, priceToolCall, type PricedCost } from "../billing/pricing";

const MAX_ERROR_CHARS = 300;

export type UsageKind = "llm" | "search" | "email" | "fetch";

export async function recordUsage(e: {
  kind: UsageKind;
  provider: string;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  ok?: boolean;
  taskId?: string | null;
  executionId?: string | null;
  latencyMs?: number | null;
  /** What an LLM call was for (plan, step, verify, verify_claims, queries, memory, suggest, other). */
  purpose?: string | null;
  /** True when the token counts are estimates (the provider reported no usage, mock, or a failed call). */
  estimated?: boolean | null;
  /** Short reason for a failed call. Redacted (API keys, bearer tokens) and clipped to 300 chars. */
  error?: string | null;
  /** The execution step the call was made for. */
  stepId?: string | null;
  /** Input tokens served from the provider's prompt cache (included in tokensIn). */
  cachedTokensIn?: number | null;
  /** HTTP attempts the call took (1 = no retry). */
  attempts?: number | null;
}): Promise<void> {
  try {
    const cost = usageCost(e);
    await prisma.usageEvent.create({
      data: {
        kind: e.kind,
        provider: e.provider,
        model: e.model ?? null,
        tokensIn: Math.max(0, Math.round(e.tokensIn ?? 0)),
        tokensOut: Math.max(0, Math.round(e.tokensOut ?? 0)),
        ok: e.ok ?? true,
        taskId: e.taskId ?? null,
        executionId: e.executionId ?? null,
        latencyMs: e.latencyMs == null ? null : Math.max(0, Math.round(e.latencyMs)),
        purpose: e.purpose ? e.purpose.slice(0, 40) : null,
        estimated: e.estimated ?? null,
        error: e.error ? redact(e.error).slice(0, MAX_ERROR_CHARS) : null,
        stepId: e.stepId ?? null,
        cachedTokensIn: e.cachedTokensIn == null ? null : Math.max(0, Math.round(e.cachedTokensIn)),
        attempts: e.attempts == null ? null : Math.max(1, Math.round(e.attempts)),
        costMicros: cost?.micros ?? null,
        costCurrency: cost?.currency ?? null,
        costSource: cost ? (e.kind === "llm" && e.estimated ? "estimated" : "computed") : null,
      },
    });
  } catch (err) {
    console.warn("[usage] could not record usage event:", err instanceof Error ? err.message : err);
  }
}

/**
 * The variable provider cost of a usage event, from the configured price table
 * (billing/pricing.ts). Only successful calls are priced: what a failed call
 * cost is unknown, so it stays null rather than being guessed.
 */
function usageCost(e: { kind: UsageKind; provider: string; model?: string | null; tokensIn?: number; tokensOut?: number; cachedTokensIn?: number | null; ok?: boolean }): PricedCost | null {
  if (e.ok === false) return null;
  if (e.kind === "llm") return priceModelCall({ provider: e.provider, model: e.model, tokensIn: e.tokensIn ?? 0, cachedTokensIn: e.cachedTokensIn, tokensOut: e.tokensOut ?? 0 });
  if (e.kind === "search") return priceToolCall(`search:${e.provider}`);
  return null;
}

export function startOfTodayUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Number of usage events of `kind` since midnight UTC (e.g. search budget). */
export async function usageCountToday(kind: UsageKind): Promise<number> {
  return prisma.usageEvent.count({ where: { kind, createdAt: { gte: startOfTodayUTC() } } });
}
