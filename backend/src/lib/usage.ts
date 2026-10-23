// Metering for the owner dashboard and budget guards (v3). Never throws:
// metering must not break a task.

import { prisma } from "../db";
import { redact } from "./log";

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
}): Promise<void> {
  try {
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
      },
    });
  } catch (err) {
    console.warn("[usage] could not record usage event:", err instanceof Error ? err.message : err);
  }
}

export function startOfTodayUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Number of usage events of `kind` since midnight UTC (e.g. search budget). */
export async function usageCountToday(kind: UsageKind): Promise<number> {
  return prisma.usageEvent.count({ where: { kind, createdAt: { gte: startOfTodayUTC() } } });
}
