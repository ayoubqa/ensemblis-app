// Execution lifecycle: every state transition, in one place.
//
//   PLANNING ─▶ PLANNED ─────────────────────────────▶ RUNNING ─▶ VERIFYING ─▶ COMPLETED
//      │           └─▶ WAITING_FOR_APPROVAL ─approve─▶ ┘   │  ▲         │
//      │                        └─reject─▶ CANCELLED       │  │         └─(fail ×2)─▶ BLOCKED
//      └─(missing info)─▶ BLOCKED ─answer─▶ PLANNING        └─(step fails)─▶ BLOCKED ─retry─┘
//   Any non-terminal state ─▶ CANCELLED (person) / FAILED (unrecoverable, refunded).
//
// Every transition is a guarded conditional update (`updateMany … where
// status in […]`) inside a transaction, so the API, the worker and the
// recovery sweeper can race without double-starting, double-charging or
// double-refunding. The objective's status mirrors its latest execution.

import { Prisma, type ExceptionKind, type ExecutionStatus, type RiskLevel } from "@prisma/client";
import { prisma } from "../db";
import { assertPlanningQuotaInTx } from "../lib/usageLimits";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { onAttentionNeeded, onExecutionSettled } from "../lib/notify";
import type { OrgContext } from "../org/organization";
import { VERIFICATION_COST_CENTS, SYNTHESIS_CAPABILITY, getCapability } from "../org/registry";
import { chargeExecution, eur, refundExecution } from "./billing";
import { emit } from "./events";
import { enqueue } from "./queue";

type Tx = Prisma.TransactionClient;

export const EXEC_TICK = "execution.tick";
export const execKey = (executionId: string) => `exec:${executionId}`;
export const TERMINAL: ExecutionStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];
/** States the worker moves forward by itself (everything else waits on a person or is final). */
export const RUNNABLE: ExecutionStatus[] = ["PLANNING", "PLANNED", "RUNNING", "VERIFYING"];
const NON_TERMINAL: ExecutionStatus[] = ["PLANNING", "PLANNED", "WAITING_FOR_APPROVAL", "RUNNING", "BLOCKED", "VERIFYING"];

export async function enqueueTick(executionId: string, delayMs = 0, db: Tx | typeof prisma = prisma): Promise<void> {
  await enqueue(EXEC_TICK, { executionId }, { dedupeKey: execKey(executionId), delayMs, maxAttempts: 5 }, db);
}

async function mirror(tx: Tx, objectiveId: string, status: ExecutionStatus, extra: Prisma.ObjectiveUpdateInput = {}) {
  await tx.objective.update({ where: { id: objectiveId }, data: { status, ...extra } });
}

async function flip(tx: Tx, executionId: string, from: ExecutionStatus[], to: ExecutionStatus, data: Prisma.ExecutionUpdateManyMutationInput = {}) {
  const r = await tx.execution.updateMany({ where: { id: executionId, status: { in: from } }, data: { status: to, ...data } });
  return r.count > 0;
}

// ---------------------------------------------------------------- creation

export async function createExecution(
  tx: Tx,
  args: { objectiveId: string; orgId: string; triggeredById: string | null; title: string; announce?: Prisma.InputJsonValue }
): Promise<{ id: string }> {
  await assertPlanningQuotaInTx(tx, args.orgId);
  const last = await tx.execution.findFirst({ where: { objectiveId: args.objectiveId }, orderBy: { attempt: "desc" }, select: { attempt: true } });
  const ex = await tx.execution.create({
    data: { objectiveId: args.objectiveId, orgId: args.orgId, attempt: (last?.attempt ?? 0) + 1, status: "PLANNING", triggeredById: args.triggeredById },
    select: { id: true },
  });
  if (args.announce !== undefined) {
    await emit(tx, { executionId: ex.id, orgId: args.orgId, type: "OBJECTIVE_CREATED", actor: "user", message: `Objective defined: ${args.title.slice(0, 160)}`, data: args.announce });
  }
  await mirror(tx, args.objectiveId, "PLANNING", { outcomeStatus: null, completedAt: null });
  await emit(tx, {
    executionId: ex.id,
    orgId: args.orgId,
    type: "PLANNING_STARTED",
    actor: "chief_of_staff",
    message: `Chief of Staff is planning “${args.title.slice(0, 120)}”`,
  });
  return ex;
}

/** Starts another attempt for an objective whose latest execution has finished. */
export async function newAttempt(org: OrgContext, objectiveId: string): Promise<string> {
  const objective = await prisma.objective.findFirst({
    where: { id: objectiveId, orgId: org.orgId },
    include: { executions: { orderBy: { attempt: "desc" }, take: 1, select: { status: true } } },
  });
  if (!objective) throw new HttpError(404, "Objective not found");
  const latest = objective.executions[0];
  if (latest && !TERMINAL.includes(latest.status)) {
    throw new HttpError(409, "This objective already has an execution in progress.");
  }
  const id = await prisma.$transaction(async (tx) => {
    const ex = await createExecution(tx, { objectiveId, orgId: org.orgId, triggeredById: org.userId, title: objective.title });
    await enqueueTick(ex.id, 0, tx);
    return ex.id;
  });
  return id;
}

// ---------------------------------------------------------------- start (charge)

/**
 * Charges the estimate and moves an uncharged execution to RUNNING. Runs in
 * the caller's transaction so it rolls back with it (e.g. insufficient funds
 * keeps an approval pending). Throws 409 when the execution can't start.
 */
export async function startInTx(tx: Tx, executionId: string, actorUserId: string, from: ExecutionStatus[]): Promise<void> {
  const ex = await tx.execution.findUniqueOrThrow({ where: { id: executionId }, include: { objective: { select: { id: true, title: true } } } });
  const ok = await tx.execution.updateMany({
    where: { id: executionId, status: { in: from }, chargedAt: null },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });
  if (ok.count === 0) throw new HttpError(409, `This execution can't be started (it is ${ex.status.toLowerCase().replace(/_/g, " ")}).`);
  if (ex.estimatedCostCents > 0) {
    await chargeExecution(tx, { executionId, orgId: ex.orgId, actorUserId, amountCents: ex.estimatedCostCents, title: ex.objective.title });
  }
  await mirror(tx, ex.objective.id, "RUNNING");
  await emit(tx, {
    executionId,
    orgId: ex.orgId,
    type: "EXECUTION_STARTED",
    actor: "chief_of_staff",
    message: "Execution started — the AI Team is working",
    data: { costCents: ex.estimatedCostCents },
  });
  if (ex.estimatedCostCents > 0) {
    await emit(tx, {
      executionId,
      orgId: ex.orgId,
      type: "FUNDS_CHARGED",
      actor: "system",
      message: `${eur(ex.estimatedCostCents)} charged to the organization's balance`,
      data: { amountCents: ex.estimatedCostCents },
    });
  }
}

// ---------------------------------------------------------------- approvals

export async function requestApproval(
  tx: Tx,
  args: {
    execution: { id: string; orgId: string; objectiveId: string };
    kind: "PLAN" | "BUDGET" | "ACTION";
    title: string;
    proposedAction: string;
    reason: string;
    costCents: number;
    risk: RiskLevel;
    recommendation: string;
    recommendedDecision: "APPROVE" | "REJECT";
  }
): Promise<boolean> {
  const { execution } = args;
  if (!(await flip(tx, execution.id, ["PLANNED"], "WAITING_FOR_APPROVAL"))) return false;
  await tx.approval.create({
    data: {
      orgId: execution.orgId,
      objectiveId: execution.objectiveId,
      executionId: execution.id,
      kind: args.kind,
      title: args.title,
      proposedAction: args.proposedAction,
      reason: args.reason,
      costCents: args.costCents,
      risk: args.risk,
      recommendation: args.recommendation,
      recommendedDecision: args.recommendedDecision,
    },
  });
  await mirror(tx, execution.objectiveId, "WAITING_FOR_APPROVAL");
  await emit(tx, {
    executionId: execution.id,
    orgId: execution.orgId,
    type: "APPROVAL_REQUESTED",
    actor: "chief_of_staff",
    message: `Approval requested: ${args.title}`,
    data: { kind: args.kind, costCents: args.costCents, risk: args.risk },
  });
  return true;
}

export async function decideApproval(org: OrgContext, approvalId: string, decision: "APPROVE" | "REJECT", note?: string): Promise<{ executionId: string }> {
  const approval = await prisma.approval.findFirst({ where: { id: approvalId, orgId: org.orgId } });
  if (!approval) throw new HttpError(404, "Approval not found");
  if (approval.status !== "PENDING") throw new HttpError(409, `This approval was already ${approval.status.toLowerCase()}.`);
  if (approval.kind === "ACTION" && org.role !== "OWNER") throw new HttpError(403, "Only the organization owner can approve external actions.");

  await prisma.$transaction(async (tx) => {
    const decided = await tx.approval.updateMany({
      where: { id: approvalId, status: "PENDING" },
      data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: org.userId, decidedAt: new Date(), decisionNote: note?.slice(0, 1000) ?? null },
    });
    if (decided.count === 0) throw new HttpError(409, "This approval was just decided by someone else.");
    const ex = await tx.execution.findUniqueOrThrow({ where: { id: approval.executionId }, select: { id: true, orgId: true, objectiveId: true } });
    if (decision === "APPROVE") {
      await emit(tx, { executionId: ex.id, orgId: ex.orgId, type: "APPROVAL_GRANTED", actor: "user", message: `Approved: ${approval.title}`, data: { by: org.userId } });
      await startInTx(tx, ex.id, org.userId, ["WAITING_FOR_APPROVAL"]);
      await enqueueTick(ex.id, 0, tx);
    } else {
      if (!(await flip(tx, ex.id, ["WAITING_FOR_APPROVAL"], "CANCELLED", { completedAt: new Date(), errorMessage: "The plan was not approved." }))) {
        throw new HttpError(409, "This execution is no longer waiting for approval.");
      }
      await tx.executionStep.updateMany({ where: { executionId: ex.id, status: "PENDING" }, data: { status: "SKIPPED" } });
      await mirror(tx, ex.objectiveId, "CANCELLED");
      await emit(tx, { executionId: ex.id, orgId: ex.orgId, type: "APPROVAL_REJECTED", actor: "user", message: `Rejected: ${approval.title}${note ? ` — ${note.slice(0, 200)}` : ""}` });
      await emit(tx, { executionId: ex.id, orgId: ex.orgId, type: "EXECUTION_CANCELLED", actor: "user", message: "Execution cancelled — nothing was charged" });
    }
  });
  log.info("execution.approval_decided", { executionId: approval.executionId, orgId: org.orgId, objectiveId: approval.objectiveId, approvalId, decision, by: org.userId });
  return { executionId: approval.executionId };
}

// ---------------------------------------------------------------- exceptions

export interface ExceptionInput {
  execution: { id: string; orgId: string; objectiveId: string };
  stepId?: string | null;
  kind: ExceptionKind;
  severity: RiskLevel;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  recommendation: string;
  neededFromUser: string;
  questions?: { question: string; whyItMatters: string }[];
  actions: ("provide_info" | "proceed" | "retry" | "accept" | "cancel")[];
}

/** Blocks the execution and records what a person needs to do. */
export async function openException(tx: Tx, e: ExceptionInput, from: ExecutionStatus[] = NON_TERMINAL): Promise<string | null> {
  if (!(await flip(tx, e.execution.id, from.filter((s) => s !== "BLOCKED"), "BLOCKED"))) return null;
  const row = await tx.exception.create({
    data: {
      orgId: e.execution.orgId,
      objectiveId: e.execution.objectiveId,
      executionId: e.execution.id,
      stepId: e.stepId ?? null,
      kind: e.kind,
      severity: e.severity,
      title: e.title.slice(0, 200),
      whatHappened: e.whatHappened,
      whyItMatters: e.whyItMatters,
      recommendation: e.recommendation,
      neededFromUser: e.neededFromUser,
      questions: (e.questions ?? []) as unknown as Prisma.InputJsonValue,
      actions: e.actions,
    },
  });
  await mirror(tx, e.execution.objectiveId, "BLOCKED");
  await emit(tx, {
    executionId: e.execution.id,
    orgId: e.execution.orgId,
    stepId: e.stepId ?? null,
    type: "EXCEPTION_CREATED",
    actor: "chief_of_staff",
    message: `Needs your attention: ${e.title}`,
    data: { kind: e.kind, exceptionId: row.id },
  });
  return row.id;
}

export function notifyAttention(executionId: string, headline: string, detail: string) {
  onAttentionNeeded(executionId, headline, detail).catch(() => undefined);
}

export type ResolveAction = "provide_info" | "proceed" | "retry" | "accept" | "cancel";

export async function resolveException(org: OrgContext, exceptionId: string, action: ResolveAction, response?: string): Promise<{ executionId: string }> {
  const exc = await prisma.exception.findFirst({ where: { id: exceptionId, orgId: org.orgId } });
  if (!exc) throw new HttpError(404, "Exception not found");
  if (exc.status !== "OPEN") throw new HttpError(409, "This exception is already resolved.");
  if (!exc.actions.includes(action)) throw new HttpError(400, `“${action}” isn't a valid way to resolve this exception.`);
  if (action === "provide_info" && (!response || response.trim().length < 3)) throw new HttpError(400, "response: Add the information the Chief of Staff asked for.");

  if (action === "cancel") {
    await cancelExecution(exc.executionId, { userId: org.userId, reason: "Cancelled while resolving an exception" });
    return { executionId: exc.executionId };
  }

  await prisma.$transaction(async (tx) => {
    const done = await tx.exception.updateMany({
      where: { id: exc.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAction: action, resolution: response?.trim().slice(0, 4000) ?? null, resolvedById: org.userId, resolvedAt: new Date() },
    });
    if (done.count === 0) throw new HttpError(409, "This exception was just resolved by someone else.");
    const ex = await tx.execution.findUniqueOrThrow({ where: { id: exc.executionId } });
    const base = { executionId: ex.id, orgId: ex.orgId };
    await emit(tx, { ...base, type: "EXCEPTION_RESOLVED", actor: "user", message: `Resolved: ${exc.title} (${action.replace("_", " ")})`, data: { exceptionId: exc.id, action } });

    if (action === "provide_info" || action === "proceed") {
      if (action === "provide_info") {
        const qs = (exc.questions as { question: string }[] | null) ?? [];
        const note = `Answer to the Chief of Staff${qs.length ? ` (${qs.map((q) => q.question).join(" / ")})` : ""}:\n${response!.trim()}`;
        const obj = await tx.objective.findUniqueOrThrow({ where: { id: ex.objectiveId }, select: { contextNotes: true } });
        await tx.objective.update({ where: { id: ex.objectiveId }, data: { contextNotes: [obj.contextNotes.trim(), note].filter(Boolean).join("\n\n").slice(0, 8000) } });
      }
      await assertPlanningQuotaInTx(tx, ex.orgId);
      if (!(await flip(tx, ex.id, ["BLOCKED"], "PLANNING"))) throw new HttpError(409, "This execution is no longer blocked.");
      await mirror(tx, ex.objectiveId, "PLANNING");
      await emit(tx, { ...base, type: "PLANNING_STARTED", actor: "chief_of_staff", message: action === "provide_info" ? "Chief of Staff is re-planning with your answer" : "Chief of Staff is planning with stated assumptions" });
      await enqueueTick(ex.id, 0, tx);
      return;
    }

    if (action === "retry") {
      if (!ex.chargedAt) {
        // Never started (insufficient funds / daily limit): charge and start now.
        await startInTx(tx, ex.id, org.userId, ["BLOCKED"]);
      } else if (exc.kind === "VERIFICATION_FAILED") {
        await addRevisionStep(tx, ex.id, [exc.whatHappened, response?.trim() ? `Guidance from ${org.userId === ex.triggeredById ? "the requester" : "your team"}: ${response.trim()}` : ""].filter(Boolean));
        if (!(await flip(tx, ex.id, ["BLOCKED"], "RUNNING"))) throw new HttpError(409, "This execution is no longer blocked.");
        await mirror(tx, ex.objectiveId, "RUNNING");
      } else {
        if (exc.stepId) {
          await tx.executionStep.updateMany({ where: { id: exc.stepId, status: "FAILED" }, data: { status: "PENDING", attempts: 0, notBefore: null } });
        }
        if (!(await flip(tx, ex.id, ["BLOCKED"], "RUNNING"))) throw new HttpError(409, "This execution is no longer blocked.");
        await mirror(tx, ex.objectiveId, "RUNNING");
      }
      await emit(tx, { ...base, type: "EXECUTION_RESUMED", actor: "user", message: "Execution resumed" });
      await enqueueTick(ex.id, 0, tx);
      return;
    }

    if (action === "accept") {
      if (!(await flip(tx, ex.id, ["BLOCKED"], "VERIFYING"))) throw new HttpError(409, "This execution is no longer blocked.");
      await mirror(tx, ex.objectiveId, "VERIFYING");
      await emit(tx, { ...base, type: "EXECUTION_RESUMED", actor: "user", message: "Result accepted with its verification warnings — finalizing" });
      await enqueueTick(ex.id, 0, tx);
    }
  });
  log.info("execution.exception_resolved", { executionId: exc.executionId, orgId: org.orgId, exceptionId, kind: exc.kind, action, by: org.userId });
  return { executionId: exc.executionId };
}

/** Appends a revision of the synthesis step carrying the verifier's feedback. */
export async function addRevisionStep(tx: Tx, executionId: string, feedback: string[]): Promise<void> {
  const steps = await tx.executionStep.findMany({ where: { executionId }, orderBy: { order: "asc" }, select: { order: true, key: true, kind: true } });
  const cap = getCapability(SYNTHESIS_CAPABILITY)!;
  const n = steps.filter((s) => s.kind === "revision").length + 1;
  await tx.executionStep.create({
    data: {
      executionId,
      key: `r${n}`,
      order: (steps[steps.length - 1]?.order ?? -1) + 1,
      title: `Revise the result to address verification findings${n > 1 ? ` (${n})` : ""}`,
      purpose: "Fix every issue the verification gate found; remove or qualify claims the evidence does not support.",
      executive: cap.executive,
      capability: cap.key,
      capabilityVersion: cap.version,
      agent: cap.specialist,
      dependsOn: steps.filter((s) => s.kind === "work").map((s) => s.key),
      inputs: feedback.slice(0, 12) as unknown as Prisma.InputJsonValue,
      outputs: cap.deliverable as unknown as Prisma.InputJsonValue,
      verification: cap.verificationFocus as unknown as Prisma.InputJsonValue,
      kind: "revision",
      costCents: 0, // included in the original estimate
    },
  });
  await tx.execution.update({ where: { id: executionId }, data: { revisionCount: { increment: 1 } } });
}

// ---------------------------------------------------------------- terminal transitions

/** Fails an execution and refunds everything not yet refunded. Idempotent. */
export async function failExecution(executionId: string, message: string): Promise<boolean> {
  let meta: { orgId: string; objectiveId: string; costCents: number; refundedCents: number } | null = null;
  const done = await prisma.$transaction(async (tx) => {
    const ex = await tx.execution.findUnique({ where: { id: executionId } });
    if (!ex) return false;
    if (!(await flip(tx, executionId, NON_TERMINAL, "FAILED", { errorMessage: message.slice(0, 2000), completedAt: new Date() }))) return false;
    await tx.executionStep.updateMany({ where: { executionId, status: "RUNNING" }, data: { status: "FAILED", error: message.slice(0, 2000), partialOutput: null } });
    await tx.executionStep.updateMany({ where: { executionId, status: "PENDING" }, data: { status: "SKIPPED" } });
    await tx.approval.updateMany({ where: { executionId, status: "PENDING" }, data: { status: "CANCELLED" } });
    await tx.exception.updateMany({ where: { executionId, status: "OPEN" }, data: { status: "DISMISSED" } });
    await mirror(tx, ex.objectiveId, "FAILED");
    await emit(tx, { executionId, orgId: ex.orgId, type: "EXECUTION_FAILED", actor: "system", message: `Execution failed: ${message.slice(0, 300)}` });
    const refunded = await refundExecution(tx, executionId, ex.costCents, "execution failed");
    if (refunded > 0) {
      await emit(tx, { executionId, orgId: ex.orgId, type: "FUNDS_REFUNDED", actor: "system", message: `${eur(refunded)} refunded`, data: { amountCents: refunded } });
    }
    meta = { orgId: ex.orgId, objectiveId: ex.objectiveId, costCents: ex.costCents, refundedCents: ex.refundedCents + refunded };
    return true;
  });
  if (done) {
    log.warn("execution.failed", { executionId, ...(meta ?? {}), error: message.slice(0, 300) });
    onExecutionSettled(executionId).catch(() => undefined);
  }
  return done;
}

/**
 * Cancels an execution. Refunds the work that never ran (steps not completed
 * and the verification gate if it didn't run) — or everything when the
 * result failed verification.
 */
export async function cancelExecution(executionId: string, opts: { userId: string | null; reason: string }): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const ex = await tx.execution.findUnique({ where: { id: executionId }, include: { steps: true } });
    if (!ex) return false;
    if (!(await flip(tx, executionId, NON_TERMINAL, "CANCELLED", { completedAt: new Date(), errorMessage: opts.reason.slice(0, 500) }))) {
      throw new HttpError(409, `This execution has already ${ex.status === "COMPLETED" ? "completed" : ex.status.toLowerCase()}.`);
    }
    const failedVerification = await tx.exception.count({ where: { executionId, status: "OPEN", kind: "VERIFICATION_FAILED" } });
    const unrun = ex.steps.filter((s) => s.status !== "COMPLETED").reduce((n, s) => n + s.costCents, 0) + (ex.verificationStatus ? 0 : VERIFICATION_COST_CENTS);
    await tx.executionStep.updateMany({ where: { executionId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "SKIPPED", partialOutput: null } });
    await tx.approval.updateMany({ where: { executionId, status: "PENDING" }, data: { status: "CANCELLED" } });
    await tx.exception.updateMany({
      where: { executionId, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAction: "cancel", resolvedById: opts.userId, resolvedAt: new Date() },
    });
    await mirror(tx, ex.objectiveId, "CANCELLED");
    await emit(tx, { executionId, orgId: ex.orgId, type: "EXECUTION_CANCELLED", actor: opts.userId ? "user" : "system", message: `Execution cancelled: ${opts.reason}` });
    const refunded = await refundExecution(tx, executionId, failedVerification ? ex.costCents : unrun, "cancelled execution");
    if (refunded > 0) {
      await emit(tx, { executionId, orgId: ex.orgId, type: "FUNDS_REFUNDED", actor: "system", message: `${eur(refunded)} refunded for work that didn't run`, data: { amountCents: refunded } });
    }
    return true;
  });
}

export async function cancelForOrg(org: OrgContext, executionId: string): Promise<void> {
  const ex = await prisma.execution.findFirst({ where: { id: executionId, orgId: org.orgId }, select: { id: true } });
  if (!ex) throw new HttpError(404, "Execution not found");
  await cancelExecution(ex.id, { userId: org.userId, reason: "Cancelled by a person" });
}
