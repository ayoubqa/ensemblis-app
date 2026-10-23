// Called once when a task reaches COMPLETED or FAILED (v3): emails the person
// who started it ("your report is ready" / "your task failed and was
// refunded"). Skipped for guests, developer test runs and users who turned
// task emails off, and a no-op when email isn't configured.
// Never throws — notification problems must not affect the task.

import { config } from "../config";
import { prisma } from "../db";
import { sendEmail } from "../email/send";
import { attentionEmail, executionFailedEmail, outcomeReadyEmail, taskCompletedEmail, taskFailedEmail, type RenderedEmail } from "../email/templates";
import { incompleteWork, type ResultStateStep } from "../engine/resultState";
import { endpointsOf, usedMockAIOf, type ExecutionEndpoints } from "../engine/serialize";

export async function onTaskSettled(taskId: string): Promise<void> {
  try {
    if (!config.email.enabled) return;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        result: true,
        costCents: true,
        isTest: true,
        user: { select: { email: true, name: true, isGuest: true, emailOnTaskDone: true } },
      },
    });
    if (!task || task.isTest) return;
    const u = task.user;
    if (u.isGuest || !u.emailOnTaskDone || !u.email || u.email.endsWith("@guest.invalid")) return;

    if (task.status === "COMPLETED") {
      const mail = taskCompletedEmail({ name: u.name, taskId: task.id, title: task.title, result: task.result });
      await sendEmail({ to: u.email, ...mail });
    } else if (task.status === "FAILED" || task.status === "REFUNDED") {
      const mail = taskFailedEmail({ name: u.name, taskId: task.id, title: task.title, refundedCents: task.costCents });
      await sendEmail({ to: u.email, ...mail });
    }
  } catch (err) {
    console.warn(`[notify] task ${taskId}:`, err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------- v4: executions
// Emails the person who started an execution. Same opt-out (emailOnTaskDone),
// never for guests, never throws.

/**
 * What an e-mail says where the console's text carries operator detail — a provider's error with env
 * var names, HTTP codes, provider names or keys, a dead job's last error. An e-mail leaves the console,
 * so it never quotes that text: these provider-free lines stand in, as on the shared report
 * (serialize.ts toPublicWarnings), and the console keeps the full detail.
 */
export const EMAIL_DETAIL = {
  /** The AI verifier could not run (machine.ts verifyPhase). */
  verifierUnavailable: "The AI verifier was unavailable, so the result has not been verified. Open the objective to retry or accept it.",
  /** The result failed verification (machine.ts verifyPhase): the failures quote the AI verifier's own text. */
  verificationFailed: "The result did not pass verification. Open the objective to review it.",
  /** Planning stopped before anything ran (the AI provider's configuration or quota, or web search off): the headline says which. */
  planBlocked: "Nothing has run and nothing was charged. Open the objective to retry or cancel.",
  /** Why an execution failed, whatever Execution.errorMessage says (a dead job's last error included). */
  executionFailed: "it stopped before a result was ready.",
} as const;

// Only while the person still belongs to the execution's organization: someone who left or was
// removed from the team must not receive its results (organization.ts: a member works in the team
// owner's organization, everyone else in their own).
async function recipient(userId: string | null, orgId: string) {
  if (!userId || !config.email.enabled) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, isGuest: true, emailOnTaskDone: true, teamMembership: { select: { team: { select: { ownerId: true } } } } },
  });
  if (!u || u.isGuest || !u.emailOnTaskDone || !u.email || u.email.endsWith("@guest.invalid")) return null;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } });
  if (!org || org.ownerId !== (u.teamMembership?.team.ownerId ?? userId)) return null;
  return { email: u.email, name: u.name };
}

const OUTCOME_LABEL: Record<string, string> = {
  ACHIEVED: "Achieved",
  PARTIALLY_ACHIEVED: "Partially achieved",
  NOT_ACHIEVED: "Not achieved",
  UNKNOWN: "Not measured",
};
const VERIFICATION_LABEL: Record<string, string> = {
  PASS: "passed",
  PASS_WITH_WARNINGS: "passed with warnings",
  FAIL: "failed (accepted)",
  // A result the AI verifier could not check completes only when a person accepts it as not verified.
  UNVERIFIED: "not verified (the AI verifier could not run; accepted by a person)",
};

/**
 * The outcome and verification wording of the "outcome ready" email. The outcome is the AI's
 * assessment unless a person confirmed it, and incomplete work (a skipped or failed step, research
 * that didn't deliver) is said, never presented as a complete result.
 */
export function outcomeEmailLabels(ex: {
  outcomeStatus: string | null;
  confirmedOutcomeStatus?: string | null;
  verificationStatus: string | null;
  steps: ResultStateStep[];
  objectiveKind?: string | null;
}): { outcomeLabel: string; verificationLabel: string } {
  const confirmed = ex.confirmedOutcomeStatus ?? null;
  const status = confirmed ?? ex.outcomeStatus ?? "UNKNOWN";
  const label = OUTCOME_LABEL[status] ?? OUTCOME_LABEL.UNKNOWN;
  const outcome = status === "UNKNOWN" ? label : `${label} (${confirmed ? "confirmed by a person" : "AI-assessed"})`;
  const partial = incompleteWork(ex.steps, ex.objectiveKind).length > 0;
  return {
    outcomeLabel: partial ? `Partially completed — ${outcome}` : outcome,
    verificationLabel: VERIFICATION_LABEL[ex.verificationStatus ?? ""] ?? "not run",
  };
}

/** The console's labels for output that is not a real model's (frontend MOCK_TAG_LABEL and the endpoint tag). */
const MOCK_OUTPUT = "Mock AI — test output";
const STUB_MODEL = "Test stub endpoint — not a real model";

/**
 * The "outcome ready" email. Test output — it ran on the mock model, or on a stub model endpoint
 * (E2E_STUB=1) — says so in the subject and before the outcome, as the console and the shared page do.
 */
export function outcomeReadyMessage(
  name: string,
  ex: Parameters<typeof outcomeEmailLabels>[0] & {
    objectiveId: string;
    title: string;
    result: string | null;
    usedMockAI: boolean;
    endpoints: Pick<ExecutionEndpoints, "model">;
  }
): RenderedEmail {
  const labels = outcomeEmailLabels(ex);
  const note = ex.usedMockAI ? MOCK_OUTPUT : ex.endpoints.model === "stub" ? STUB_MODEL : null;
  const mail = outcomeReadyEmail({
    name,
    objectiveId: ex.objectiveId,
    title: ex.title,
    result: ex.result,
    verificationLabel: labels.verificationLabel,
    outcomeLabel: note ? `${note} — ${labels.outcomeLabel}` : labels.outcomeLabel,
  });
  return note ? { ...mail, subject: `[${note}] ${mail.subject}` } : mail;
}

export async function onExecutionSettled(executionId: string): Promise<void> {
  try {
    const ex = await prisma.execution.findUnique({
      where: { id: executionId },
      select: {
        orgId: true,
        status: true,
        result: true,
        triggeredById: true,
        outcomeStatus: true,
        confirmedOutcomeStatus: true,
        verificationStatus: true,
        refundedCents: true,
        plan: true,
        objective: { select: { id: true, title: true, kind: true } },
        steps: { select: { kind: true, status: true, researchStatus: true, title: true, provider: true, research: true } },
        verifications: { select: { modelProvider: true } },
      },
    });
    if (!ex) return;
    const u = await recipient(ex.triggeredById, ex.orgId);
    if (!u) return;
    if (ex.status === "COMPLETED") {
      await sendEmail({
        to: u.email,
        ...outcomeReadyMessage(u.name, {
          ...ex,
          objectiveId: ex.objective.id,
          title: ex.objective.title,
          objectiveKind: ex.objective.kind,
          usedMockAI: usedMockAIOf(ex),
          endpoints: endpointsOf(ex),
        }),
      });
    } else if (ex.status === "FAILED") {
      await sendEmail({
        to: u.email,
        ...executionFailedEmail({ name: u.name, objectiveId: ex.objective.id, title: ex.objective.title, refundedCents: ex.refundedCents, reason: EMAIL_DETAIL.executionFailed }),
      });
    }
  } catch (err) {
    console.warn(`[notify] execution ${executionId}:`, err instanceof Error ? err.message : err);
  }
}

export async function onAttentionNeeded(executionId: string, headline: string, detail: string): Promise<void> {
  try {
    const ex = await prisma.execution.findUnique({ where: { id: executionId }, select: { orgId: true, triggeredById: true, objective: { select: { id: true, title: true } } } });
    if (!ex) return;
    const u = await recipient(ex.triggeredById, ex.orgId);
    if (!u) return;
    await sendEmail({ to: u.email, ...attentionEmail({ name: u.name, objectiveId: ex.objective.id, title: ex.objective.title, headline, detail }) });
  } catch (err) {
    console.warn(`[notify] attention ${executionId}:`, err instanceof Error ? err.message : err);
  }
}
