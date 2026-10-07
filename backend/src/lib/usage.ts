// Metering for the owner dashboard and budget guards (v3). Never throws:
// metering must not break a task.

import { prisma } from "../db";

export type UsageKind = "llm" | "search" | "email" | "fetch";

export async function recordUsage(e: {
  kind: UsageKind;
  provider: string;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  ok?: boolean;
  taskId?: string | null;
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
