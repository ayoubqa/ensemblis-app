// The persistent execution event log. Append-only; the id is a monotonic
// cursor the live UI resumes from (SSE Last-Event-ID). Every state change of
// an execution is recorded here so a person can see what Ensemblis did.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";

type Db = PrismaClient | Prisma.TransactionClient;

export const EVENT_TYPES = [
  "OBJECTIVE_CREATED",
  "PLANNING_STARTED",
  "OBJECTIVE_PLANNED",
  "CRITERIA_PROPOSED",
  "APPROVAL_REQUESTED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
  "EXECUTION_STARTED",
  "STEP_STARTED",
  "CONTEXT_RETRIEVED",
  "RESEARCH_STARTED",
  "SOURCE_FOUND",
  "ANALYSIS_COMPLETED",
  "STEP_COMPLETED",
  "STEP_RETRY_SCHEDULED",
  "STEP_FAILED",
  "EXCEPTION_CREATED",
  "EXCEPTION_RESOLVED",
  "VERIFICATION_STARTED",
  "VERIFICATION_COMPLETED",
  "REVISION_REQUESTED",
  "OUTCOME_MEASURED",
  "MEMORY_LEARNED",
  "EXECUTION_COMPLETED",
  "EXECUTION_FAILED",
  "EXECUTION_CANCELLED",
  "EXECUTION_RESUMED",
  "FUNDS_CHARGED",
  "FUNDS_REFUNDED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventInput {
  executionId: string;
  orgId: string;
  stepId?: string | null;
  type: EventType;
  /** Who acted: an executive key (chief_of_staff, marketing, …), "system" or "user". */
  actor: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

/** Appends an event and marks the execution as having made progress. */
export async function emit(db: Db, e: EventInput): Promise<number> {
  const row = await db.executionEvent.create({
    data: {
      executionId: e.executionId,
      orgId: e.orgId,
      stepId: e.stepId ?? null,
      type: e.type,
      actor: e.actor,
      message: e.message.slice(0, 500),
      data: e.data ?? {},
    },
    select: { id: true },
  });
  await db.execution.update({ where: { id: e.executionId }, data: { lastProgressAt: new Date() } });
  return row.id;
}

export function emitNow(e: EventInput): Promise<number> {
  return emit(prisma, e);
}
