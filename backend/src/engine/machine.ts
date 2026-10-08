// The execution state machine, run by the worker one tick at a time.
//
// A tick does ONE bounded unit of work for one execution and persists it:
//   PLANNING  → the Chief of Staff plans (→ PLANNED)
//   PLANNED   → the plan's next state (→ BLOCKED / WAITING_FOR_APPROVAL / RUNNING)
//   RUNNING   → the next runnable step runs (or → VERIFYING when all are done)
//   VERIFYING → the verification gate runs (→ revision / BLOCKED / COMPLETED)
// After every tick the worker re-enqueues the execution while it is still in
// a runnable state. Because each step's result is committed before the next
// tick, a crash or redeploy loses at most the step in flight: its job lease
// expires, the job is re-claimed, the stale RUNNING step is reset and re-run.

import type { Execution, ExecutionStep } from "@prisma/client";
import { prisma } from "../db";
import { log } from "../lib/log";
import { onExecutionSettled } from "../lib/notify";
import { HttpError } from "../lib/http";
import { DailyLimitError } from "../lib/usageLimits";
import { contextCompleteness, formatCompanyProfile, getCompanyContext } from "../context/service";
import { relevantMemories } from "../memory/service";
import { decideApproval as approvalPolicy } from "../org/policy";
import { getCapability, getExecutive } from "../org/registry";
import { emit } from "./events";
import { runStep, StepError } from "./executor";
import { learnFromExecution } from "./learning";
import { addRevisionStep, failExecution, notifyAttention, openException, requestApproval, startInTx } from "./lifecycle";
import { recordOutcome } from "./outcome";
import { DEFAULT_CRITERIA, planObjective, type Plan } from "./planner";
import { titleFor } from "./objectives";
import { eur } from "./billing";
import { verifyExecution } from "./verification/service";
import type { ModelAssessment } from "./verification/checks";
import type { Prisma } from "@prisma/client";

export const MAX_STEP_ATTEMPTS = 3;
export const MAX_AUTO_REVISIONS = 1;
/** Backoff before retrying a failed step (STEP_RETRY_DELAYS_MS="5000,20000" overrides; tests use 0). */
const RETRY_DELAYS_MS = (process.env.STEP_RETRY_DELAYS_MS ?? "5000,20000,60000")
  .split(",")
  .map((x) => Math.max(0, Number(x) || 0));

export interface TickResult {
  /** Ask the worker to run the next tick no earlier than this. */
  nextRunInMs?: number;
}

const execTitle = (k: string) => getExecutive(k)?.title ?? k;

export async function executionTick(executionId: string): Promise<TickResult> {
  const ex = await prisma.execution.findUnique({ where: { id: executionId } });
  if (!ex) return {};
  switch (ex.status) {
    case "PLANNING":
      await planPhase(ex);
      return {};
    case "PLANNED":
      await afterPlan(ex.id);
      return {};
    case "RUNNING":
      return advancePhase(ex);
    case "VERIFYING":
      await verifyPhase(ex);
      return {};
    default:
      return {}; // waiting on a person, or finished
  }
}

// ---------------------------------------------------------------- planning

async function planPhase(ex: Execution): Promise<void> {
  const objective = await prisma.objective.findUniqueOrThrow({
    where: { id: ex.objectiveId },
    include: { criteria: { orderBy: { order: "asc" } }, organization: true },
  });
  const ctx = await getCompanyContext(ex.orgId);
  const memories = await relevantMemories(ex.orgId, `${objective.title} ${objective.statement}`);
  const docs = await prisma.contextDocument.findMany({ where: { orgId: ex.orgId }, select: { name: true }, orderBy: { createdAt: "asc" }, take: 25 });
  const questionsSettled = (await prisma.exception.count({ where: { objectiveId: objective.id, kind: "MISSING_INFORMATION", status: "RESOLVED" } })) > 0;

  const plan: Plan = await planObjective({
    title: objective.title,
    statement: objective.statement,
    contextNotes: objective.contextNotes,
    deadline: objective.deadline,
    budgetCents: objective.budgetCents,
    criteria: objective.criteria,
    companyProfile: formatCompanyProfile(ctx),
    memories: memories.map((m) => `${m.kind.toLowerCase()}: ${m.content}`),
    documentTitles: docs.map((d) => d.name),
    executionId: ex.id,
    questionsSettled,
  });

  const persisted = await prisma.$transaction(async (tx) => {
    const still = await tx.execution.updateMany({
      where: { id: ex.id, status: "PLANNING" },
      data: {
        status: "PLANNED",
        plan: plan as unknown as Prisma.InputJsonValue,
        planSource: plan.source,
        plannerVersion: plan.version,
        estimatedCostCents: plan.estimatedCostCents,
        estimatedManualHours: plan.estimatedManualHours,
      },
    });
    if (still.count === 0) return false; // cancelled meanwhile
    await tx.executionStep.deleteMany({ where: { executionId: ex.id } });
    await tx.executionStep.createMany({
      data: plan.steps.map((s, i) => ({
        executionId: ex.id,
        key: s.key,
        order: i,
        title: s.title,
        purpose: s.purpose,
        executive: s.executive,
        capability: s.capability,
        capabilityVersion: s.capabilityVersion,
        agent: s.agent,
        dependsOn: s.dependsOn,
        inputs: s.inputs,
        outputs: s.outputs,
        verification: s.verification,
        costCents: s.costCents,
      })),
    });
    let proposed = 0;
    if (!objective.criteria.length) {
      const list = plan.successCriteria.length ? plan.successCriteria : DEFAULT_CRITERIA;
      await tx.successCriterion.createMany({
        data: list.map((c, i) => ({ objectiveId: objective.id, order: i, description: c.description, kind: c.kind, targetValue: c.targetValue, unit: c.unit, source: "proposed" })),
      });
      proposed = list.length;
    }
    // A title derived from the first words of the statement is replaced by the Chief of Staff's concise one.
    const autoTitle = objective.title === titleFor(objective.statement);
    await tx.objective.update({
      where: { id: objective.id },
      data: { status: "PLANNED", ...(autoTitle && plan.source === "planner" && plan.title.trim().length >= 3 ? { title: plan.title.trim().slice(0, 140) } : {}) },
    });
    const owners = [...new Set(plan.steps.map((s) => execTitle(s.executive)))];
    await emit(tx, {
      executionId: ex.id,
      orgId: ex.orgId,
      type: "OBJECTIVE_PLANNED",
      actor: "chief_of_staff",
      message: `Plan ready: ${plan.steps.length} steps across ${owners.join(", ")} · estimated ${eur(plan.estimatedCostCents)}`,
      data: { steps: plan.steps.length, costCents: plan.estimatedCostCents, source: plan.source, notes: plan.notes },
    });
    if (proposed) {
      await emit(tx, {
        executionId: ex.id,
        orgId: ex.orgId,
        type: "CRITERIA_PROPOSED",
        actor: "chief_of_staff",
        message: `Chief of Staff proposed ${proposed} success criteri${proposed === 1 ? "on" : "a"}`,
      });
    }
    return true;
  });
  if (!persisted) return;
  log.info("execution.planned", {
    executionId: ex.id,
    orgId: ex.orgId,
    objectiveId: objective.id,
    planSource: plan.source,
    steps: plan.steps.length,
    capabilities: plan.steps.map((s) => s.capability),
    estimatedCostCents: plan.estimatedCostCents,
    blockingQuestions: plan.missingInformation.filter((q) => q.blocking).length,
    normalizations: plan.notes.length,
  });
  await afterPlan(ex.id);
}

/**
 * PLANNED → what the persisted plan calls for: a person's answers (BLOCKED), an approval
 * (WAITING_FOR_APPROVAL) or the start (RUNNING). Also a tick of its own, so an error here (a
 * dropped connection while charging, a worker killed half-way) is retried instead of leaving the
 * execution PLANNED for good. Every transition is guarded on PLANNED, so a repeat is harmless.
 */
async function afterPlan(executionId: string): Promise<void> {
  const ex = await prisma.execution.findUnique({ where: { id: executionId } });
  if (!ex || ex.status !== "PLANNED" || !ex.plan) return;
  const plan = ex.plan as unknown as Plan;
  const objective = await prisma.objective.findUniqueOrThrow({
    where: { id: ex.objectiveId },
    include: { criteria: { orderBy: { order: "asc" } }, organization: true },
  });
  const base = { id: ex.id, orgId: ex.orgId, objectiveId: objective.id };

  // 1. Missing information the result depends on → ask a person before spending anything.
  const blocking = plan.missingInformation.filter((q) => q.blocking);
  if (blocking.length) {
    const completeness = contextCompleteness(await getCompanyContext(ex.orgId));
    const opened = await prisma.$transaction((tx) =>
      openException(
        tx,
        {
          execution: base,
          kind: "MISSING_INFORMATION",
          severity: "MEDIUM",
          title: "The Chief of Staff needs information before starting",
          whatHappened: `Planning found ${blocking.length} question${blocking.length === 1 ? "" : "s"} the AI Team can't answer from your company context${completeness.missing.length ? ` (missing: ${completeness.missing.join(", ")})` : ""}.`,
          whyItMatters: blocking.map((q) => q.whyItMatters).filter(Boolean).join(" ") || "Without it the result would rest on guesses.",
          recommendation: "Answer the questions below (and consider adding the answers to Company Context so you don't have to repeat them). Or proceed and the team will state its assumptions.",
          neededFromUser: blocking.map((q) => q.question).join("\n"),
          questions: blocking.map((q) => ({ question: q.question, whyItMatters: q.whyItMatters })),
          actions: ["provide_info", "proceed", "cancel"],
        },
        ["PLANNED"]
      )
    );
    if (opened) {
      log.info("execution.blocked", { executionId: ex.id, orgId: ex.orgId, objectiveId: ex.objectiveId, kind: "MISSING_INFORMATION", exceptionId: opened });
      notifyAttention(ex.id, "The Chief of Staff has a question", blocking[0].question);
    }
    return;
  }

  // 2. Approval policy.
  const decision = approvalPolicy({
    autonomy: objective.autonomy,
    estimatedCostCents: plan.estimatedCostCents,
    budgetCents: objective.budgetCents,
    approvalThresholdCents: objective.organization.approvalThresholdCents,
    capabilityKeys: plan.steps.map((s) => s.capability),
    criteriaCount: objective.criteria.length || plan.successCriteria.length || DEFAULT_CRITERIA.length,
  });
  if (decision.required) {
    const kind = decision.kind ?? "PLAN";
    const requested = await prisma.$transaction((tx) =>
      requestApproval(tx, {
        execution: base,
        kind,
        title: kind === "PLAN" ? `Approve the plan for “${objective.title.slice(0, 90)}”` : `Approve ${eur(plan.estimatedCostCents)} for “${objective.title.slice(0, 80)}”`,
        proposedAction: `Run ${plan.steps.length} read-only steps (${plan.steps.map((s) => getCapability(s.capability)?.name ?? s.capability).join(" → ")}), then verify the result. Estimated cost ${eur(plan.estimatedCostCents)}.`,
        reason: decision.reasons.join(" "),
        costCents: plan.estimatedCostCents,
        risk: decision.risk,
        recommendation: decision.recommendation,
        recommendedDecision: decision.recommendedDecision,
      })
    );
    if (requested) log.info("execution.approval_requested", { executionId: ex.id, orgId: ex.orgId, objectiveId: ex.objectiveId, kind, estimatedCostCents: plan.estimatedCostCents });
    if (requested) notifyAttention(ex.id, "A plan is waiting for your approval", `${plan.steps.length} steps, estimated ${eur(plan.estimatedCostCents)}.`);
    return;
  }

  // 3. Within policy: start now (charge the estimate).
  await startOrBlock(ex.id, ex.triggeredById ?? objective.organization.ownerId, base);
}

/** Starts an uncharged execution; turns a funding / limit problem into an exception. */
async function startOrBlock(executionId: string, actorUserId: string, base: { id: string; orgId: string; objectiveId: string }): Promise<void> {
  try {
    await prisma.$transaction((tx) => startInTx(tx, executionId, actorUserId, ["PLANNED"]));
    log.info("execution.started", { executionId, orgId: base.orgId, objectiveId: base.objectiveId, by: "policy" });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 402 || err.status === 429 || err.status === 403)) {
      const funds = err.status === 402;
      const opened = await prisma.$transaction((tx) =>
        openException(
          tx,
          {
            execution: base,
            kind: funds ? "INSUFFICIENT_FUNDS" : "POLICY_BLOCKED",
            severity: "MEDIUM",
            title: funds ? "Not enough balance to start" : err instanceof DailyLimitError ? "Daily execution limit reached" : "This execution isn't allowed to start",
            whatHappened: err.message,
            whyItMatters: "The plan is ready, but nothing has run and nothing was charged.",
            recommendation: funds ? "Add funds in Usage, then retry." : "Retry later, or cancel this execution.",
            neededFromUser: funds ? "Top up the organization's balance, then choose Retry." : "Choose Retry once the limit resets.",
            actions: ["retry", "cancel"],
          },
          ["PLANNED"]
        )
      );
      if (opened) {
        log.info("execution.blocked", { executionId, orgId: base.orgId, objectiveId: base.objectiveId, kind: funds ? "INSUFFICIENT_FUNDS" : "POLICY_BLOCKED", exceptionId: opened });
        notifyAttention(executionId, funds ? "Not enough balance to start" : "An execution couldn't start", err.message);
      }
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------- steps

async function advancePhase(ex: Execution): Promise<TickResult> {
  const steps = await prisma.executionStep.findMany({ where: { executionId: ex.id }, orderBy: { order: "asc" } });

  // A step still RUNNING at the start of a tick was interrupted (one job per execution).
  const stale = steps.filter((s) => s.status === "RUNNING");
  if (stale.length) {
    await prisma.executionStep.updateMany({ where: { id: { in: stale.map((s) => s.id) }, status: "RUNNING" }, data: { status: "PENDING", partialOutput: null } });
    await emit(prisma, {
      executionId: ex.id,
      orgId: ex.orgId,
      type: "EXECUTION_RESUMED",
      actor: "system",
      message: `Resumed after an interruption — re-running “${stale[0].title}”`,
    });
    for (const s of stale) s.status = "PENDING";
  }

  const done = new Set(steps.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").map((s) => s.key));
  const pending = steps.filter((s) => s.status === "PENDING");
  if (!pending.length) {
    const failed = steps.find((s) => s.status === "FAILED");
    if (failed) return blockOnStep(ex, failed, failed.error ?? "This step failed.", false);
    await prisma.$transaction(async (tx) => {
      const ok = await tx.execution.updateMany({ where: { id: ex.id, status: "RUNNING" }, data: { status: "VERIFYING" } });
      if (ok.count) await tx.objective.update({ where: { id: ex.objectiveId }, data: { status: "VERIFYING" } });
    });
    return {};
  }
  const next = pending.find((s) => s.dependsOn.every((d) => done.has(d)));
  if (!next) {
    const blocked = pending[0];
    return blockOnStep(ex, blocked, `“${blocked.title}” depends on a step that didn't complete.`, false);
  }
  if (next.notBefore && next.notBefore.getTime() > Date.now()) return { nextRunInMs: next.notBefore.getTime() - Date.now() };

  return runOneStep(ex, next, steps);
}

async function runOneStep(ex: Execution, step: ExecutionStep, steps: ExecutionStep[]): Promise<TickResult> {
  const attempt = step.attempts + 1;
  const claimed = await prisma.executionStep.updateMany({
    where: { id: step.id, status: "PENDING" },
    data: { status: "RUNNING", attempts: attempt, startedAt: new Date(), error: null, partialOutput: null, notBefore: null },
  });
  if (claimed.count === 0) return {};
  const fresh = { ...step, status: "RUNNING" as const, attempts: attempt };
  const cap = getCapability(step.capability);
  await emit(prisma, {
    executionId: ex.id,
    orgId: ex.orgId,
    stepId: step.id,
    type: "STEP_STARTED",
    actor: step.executive,
    message: `${execTitle(step.executive)} → ${step.agent}: ${step.title}${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
    data: { capability: step.capability, version: step.capabilityVersion, attempt },
  });

  const objective = await prisma.objective.findUniqueOrThrow({ where: { id: ex.objectiveId }, include: { criteria: { orderBy: { order: "asc" } } } });
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const prior =
    step.kind === "revision"
      ? steps.filter((s) => s.status === "COMPLETED" && s.order < step.order)
      : step.dependsOn.map((k) => byKey.get(k)).filter((s): s is ExecutionStep => !!s && s.status === "COMPLETED");
  const started = Date.now();
  try {
    const out = await runStep({
      execution: { id: ex.id, orgId: ex.orgId },
      objective,
      criteria: objective.criteria,
      step: fresh,
      totalSteps: steps.length,
      priorSteps: prior,
      revisionFeedback: step.kind === "revision" ? (step.inputs as string[]).join("\n") : null,
    });
    const finalText = cap?.kind === "synthesis";
    const committed = await prisma.$transaction(async (tx) => {
      // Fenced: only this attempt may complete the step (a re-claimed run wins otherwise).
      const ok = await tx.executionStep.updateMany({
        where: { id: step.id, status: "RUNNING", attempts: attempt },
        data: {
          status: "COMPLETED",
          output: out.output,
          summary: out.summary.slice(0, 300),
          partialOutput: null,
          provider: out.provider,
          model: out.model,
          tokensIn: out.tokensIn,
          tokensOut: out.tokensOut,
          latencyMs: out.latencyMs,
          completedAt: new Date(),
        },
      });
      if (ok.count === 0) return false;
      if (finalText) await tx.execution.update({ where: { id: ex.id }, data: { result: out.output, summary: out.summary } });
      if (cap?.kind === "analysis") {
        await emit(tx, { executionId: ex.id, orgId: ex.orgId, stepId: step.id, type: "ANALYSIS_COMPLETED", actor: step.executive, message: `${step.agent} completed the analysis` });
      }
      await emit(tx, {
        executionId: ex.id,
        orgId: ex.orgId,
        stepId: step.id,
        type: "STEP_COMPLETED",
        actor: step.executive,
        message: `${step.agent} completed “${step.title}”${out.summary ? `: ${out.summary}` : ""}`,
        data: { evidence: out.newEvidence.length, latencyMs: out.latencyMs, tokensIn: out.tokensIn, tokensOut: out.tokensOut },
      });
      return true;
    });
    log.info("execution.step_completed", { executionId: ex.id, orgId: ex.orgId, objectiveId: ex.objectiveId, stepId: step.id, capability: step.capability, attempt, ms: Date.now() - started, committed });
    return {};
  } catch (err) {
    const e = err instanceof StepError ? err : new StepError(err instanceof Error ? err.message : "Unknown error", true);
    log.warn("execution.step_failed", { executionId: ex.id, orgId: ex.orgId, stepId: step.id, capability: step.capability, attempt, retryable: e.retryable, error: e.message });
    if (e.retryable && attempt < MAX_STEP_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      const ok = await prisma.executionStep.updateMany({
        where: { id: step.id, status: "RUNNING", attempts: attempt },
        data: { status: "PENDING", error: e.message.slice(0, 2000), partialOutput: null, notBefore: new Date(Date.now() + delay) },
      });
      if (ok.count) {
        await emit(prisma, {
          executionId: ex.id,
          orgId: ex.orgId,
          stepId: step.id,
          type: "STEP_RETRY_SCHEDULED",
          actor: "system",
          message: `“${step.title}” failed (${e.message.slice(0, 160)}) — retrying in ${Math.round(delay / 1000)}s`,
          data: { attempt, delayMs: delay },
        });
      }
      return { nextRunInMs: delay };
    }
    const failed = await prisma.executionStep.updateMany({
      where: { id: step.id, status: "RUNNING", attempts: attempt },
      data: { status: "FAILED", error: e.message.slice(0, 2000), partialOutput: null, completedAt: new Date() },
    });
    if (failed.count === 0) return {}; // cancelled meanwhile, or a newer attempt owns the step
    await emit(prisma, { executionId: ex.id, orgId: ex.orgId, stepId: step.id, type: "STEP_FAILED", actor: step.executive, message: `“${step.title}” failed: ${e.message.slice(0, 300)}` });
    return blockOnStep(ex, step, e.message, e.kind === "policy");
  }
}

async function blockOnStep(ex: Execution, step: ExecutionStep, message: string, policy: boolean): Promise<TickResult> {
  const config = /isn't configured|API key|recognise the model/i.test(message);
  const tooLarge = /too large for the AI model/i.test(message);
  const opened = await prisma.$transaction((tx) =>
    openException(
      tx,
      {
        execution: { id: ex.id, orgId: ex.orgId, objectiveId: ex.objectiveId },
        stepId: step.id,
        kind: policy ? "POLICY_BLOCKED" : "STEP_FAILED",
        severity: policy ? "HIGH" : "MEDIUM",
        title: policy ? `“${step.title}” was blocked by policy` : `“${step.title}” couldn't be completed`,
        whatHappened: `${step.agent} (${execTitle(step.executive)}) failed after ${step.attempts || 1} attempt${(step.attempts || 1) === 1 ? "" : "s"}: ${message.slice(0, 600)}`,
        whyItMatters: "The remaining steps depend on this one, so the execution is paused. Completed work is kept.",
        recommendation: policy
          ? "Cancel this execution. This step needs a permission your organization doesn't grant."
          : tooLarge
            ? "This step's input is larger than the AI model accepts. Shorten the objective's context notes or remove large Company Context documents, then retry. Or cancel for a refund of the work that didn't run."
            : config
            ? "The AI provider is misconfigured on the server. Ask the operator to fix it, then retry. Or cancel for a refund of the work that didn't run."
            : "Retry the step — most failures are temporary (rate limits, timeouts). If it keeps failing, cancel and you'll be refunded for the work that didn't run.",
        neededFromUser: policy ? "Cancel the execution." : "Choose Retry or Cancel.",
        actions: policy ? ["cancel"] : ["retry", "cancel"],
      },
      ["RUNNING"]
    )
  );
  if (opened) {
    log.info("execution.blocked", { executionId: ex.id, orgId: ex.orgId, objectiveId: ex.objectiveId, kind: policy ? "POLICY_BLOCKED" : "STEP_FAILED", stepId: step.id, exceptionId: opened });
    notifyAttention(ex.id, "An execution needs your attention", `“${step.title}” couldn't be completed.`);
  }
  return {};
}

// ---------------------------------------------------------------- verification + completion

async function verifyPhase(ex: Execution): Promise<void> {
  if (!ex.result?.trim()) {
    await failExecution(ex.id, "The synthesis step produced no result to verify.");
    return;
  }
  const latest = await prisma.verification.findFirst({ where: { executionId: ex.id }, orderBy: { round: "desc" } });
  const accepted = latest
    ? await prisma.exception.findFirst({
        where: { executionId: ex.id, kind: "VERIFICATION_FAILED", resolvedAction: "accept", resolvedAt: { gte: latest.createdAt } },
      })
    : null;
  if (latest && accepted) {
    await finalize(ex, (latest.assessment as unknown as ModelAssessment | null) ?? null, true);
    return;
  }

  await emit(prisma, { executionId: ex.id, orgId: ex.orgId, type: "VERIFICATION_STARTED", actor: "chief_of_staff", message: "Verifying the result: evidence, success criteria, completeness, consistency" });
  const v = await verifyExecution(ex.id);
  await emit(prisma, {
    executionId: ex.id,
    orgId: ex.orgId,
    type: "VERIFICATION_COMPLETED",
    actor: "chief_of_staff",
    message: `Verification ${v.status.replace(/_/g, " ").toLowerCase()} — score ${v.score}/100`,
    data: { status: v.status, score: v.score, round: v.round },
  });
  log.info("execution.verified", { executionId: ex.id, orgId: ex.orgId, status: v.status, score: v.score, round: v.round, method: v.model ? "deterministic+model" : "deterministic" });

  if (v.status === "FAIL") {
    const fresh = await prisma.execution.findUniqueOrThrow({ where: { id: ex.id }, select: { revisionCount: true } });
    if (fresh.revisionCount < MAX_AUTO_REVISIONS) {
      await prisma.$transaction(async (tx) => {
        const ok = await tx.execution.updateMany({ where: { id: ex.id, status: "VERIFYING" }, data: { status: "RUNNING" } });
        if (!ok.count) return;
        await addRevisionStep(tx, ex.id, v.failures.length ? v.failures : [v.summary]);
        await tx.objective.update({ where: { id: ex.objectiveId }, data: { status: "RUNNING" } });
        await emit(tx, { executionId: ex.id, orgId: ex.orgId, type: "REVISION_REQUESTED", actor: "chief_of_staff", message: "The result didn't pass verification — the Synthesis Lead is revising it" });
      });
      return;
    }
    const opened = await prisma.$transaction((tx) =>
      openException(
        tx,
        {
          execution: { id: ex.id, orgId: ex.orgId, objectiveId: ex.objectiveId },
          kind: "VERIFICATION_FAILED",
          severity: "HIGH",
          title: "The result didn't pass verification",
          whatHappened: `${v.summary} ${v.failures.slice(0, 4).join(" ")}`.trim(),
          whyItMatters: "Ensemblis won't present an unverified result as complete. You decide whether it is usable.",
          recommendation:
            "Review the verification details. Accept it if the flagged points don't affect your decision; retry with guidance if they do; or cancel for a full refund.",
          neededFromUser: "Accept with warnings, retry with guidance, or cancel.",
          actions: ["accept", "retry", "cancel"],
        },
        ["VERIFYING"]
      )
    );
    if (opened) {
      log.info("execution.blocked", { executionId: ex.id, orgId: ex.orgId, objectiveId: ex.objectiveId, kind: "VERIFICATION_FAILED", exceptionId: opened });
      notifyAttention(ex.id, "A result failed verification", v.summary);
    }
    return;
  }
  await finalize(ex, v.model, false);
}

async function finalize(ex: Execution, model: ModelAssessment | null, accepted: boolean): Promise<void> {
  const objective = await prisma.objective.findUniqueOrThrow({ where: { id: ex.objectiveId }, include: { criteria: { orderBy: { order: "asc" } } } });
  const outcome = await prisma.$transaction((tx) => recordOutcome(tx, { executionId: ex.id, criteria: objective.criteria, model, acceptedDespiteFailure: accepted }));
  await emit(prisma, {
    executionId: ex.id,
    orgId: ex.orgId,
    type: "OUTCOME_MEASURED",
    actor: "chief_of_staff",
    message: `Outcome: ${outcome.status.replace(/_/g, " ").toLowerCase()} — ${outcome.summary}`,
    data: { status: outcome.status },
  });

  const learned = await learnFromExecution({
    executionId: ex.id,
    orgId: ex.orgId,
    objectiveTitle: objective.title,
    statement: objective.statement,
    contextNotes: objective.contextNotes,
    outcomeSummary: outcome.summary,
  });
  if (learned.length) {
    const active = learned.filter((m) => m.status === "ACTIVE").length;
    await emit(prisma, {
      executionId: ex.id,
      orgId: ex.orgId,
      type: "MEMORY_LEARNED",
      actor: "chief_of_staff",
      message: `Learned ${learned.length} thing${learned.length === 1 ? "" : "s"} for next time${learned.length - active ? ` (${learned.length - active} waiting for your confirmation)` : ""}`,
      data: { memoryIds: learned.map((m) => m.id) },
    });
  }

  const completed = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const ok = await tx.execution.updateMany({
      where: { id: ex.id, status: "VERIFYING" },
      data: { status: "COMPLETED", completedAt: now, outcomeStatus: outcome.status, outcomeSummary: outcome.summary },
    });
    if (!ok.count) return false;
    const fresh = await tx.execution.findUniqueOrThrow({ where: { id: ex.id } });
    await tx.objective.update({ where: { id: ex.objectiveId }, data: { status: "COMPLETED", outcomeStatus: outcome.status, completedAt: now } });
    const values: Prisma.ValueRecordCreateManyInput[] = [
      { orgId: ex.orgId, executionId: ex.id, objectiveId: ex.objectiveId, metric: "execution_cost", value: fresh.costCents - fresh.refundedCents, unit: "eur_cents" },
      { orgId: ex.orgId, executionId: ex.id, objectiveId: ex.objectiveId, metric: "criteria_met", value: outcome.measurements.filter((m) => m.result === "MET").length, unit: "count" },
    ];
    if (fresh.startedAt) {
      values.push({ orgId: ex.orgId, executionId: ex.id, objectiveId: ex.objectiveId, metric: "cycle_time", value: Math.round((now.getTime() - fresh.startedAt.getTime()) / 1000), unit: "seconds" });
    }
    if (fresh.estimatedManualHours != null) {
      values.push({
        orgId: ex.orgId,
        executionId: ex.id,
        objectiveId: ex.objectiveId,
        metric: "estimated_hours_returned",
        value: fresh.estimatedManualHours,
        unit: "hours",
        isEstimate: true,
        note: "Chief of Staff's planning estimate of analyst time; not measured.",
      });
    }
    await tx.valueRecord.createMany({ data: values });
    await emit(tx, {
      executionId: ex.id,
      orgId: ex.orgId,
      type: "EXECUTION_COMPLETED",
      actor: "chief_of_staff",
      message: `Completed — ${outcome.summary}`,
      data: { outcome: outcome.status, verification: fresh.verificationStatus, score: fresh.verificationScore },
    });
    return true;
  });
  if (completed) {
    const final = await prisma.execution.findUnique({
      where: { id: ex.id },
      select: { costCents: true, refundedCents: true, startedAt: true, completedAt: true, verificationStatus: true, verificationScore: true, revisionCount: true, planSource: true },
    });
    log.info("execution.completed", {
      executionId: ex.id,
      orgId: ex.orgId,
      objectiveId: ex.objectiveId,
      outcome: outcome.status,
      verification: final?.verificationStatus,
      score: final?.verificationScore,
      revisions: final?.revisionCount,
      planSource: final?.planSource,
      costCents: final?.costCents,
      refundedCents: final?.refundedCents,
      durationMs: final?.startedAt && final.completedAt ? final.completedAt.getTime() - final.startedAt.getTime() : undefined,
    });
    onExecutionSettled(ex.id).catch(() => undefined);
  }
}
