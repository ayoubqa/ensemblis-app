// Called once when a task reaches COMPLETED or FAILED (v3): emails the person
// who started it ("your report is ready" / "your task failed and was
// refunded"). Skipped for guests, developer test runs and users who turned
// task emails off, and a no-op when email isn't configured.
// Never throws — notification problems must not affect the task.

import { config } from "../config";
import { prisma } from "../db";
import { sendEmail } from "../email/send";
import { attentionEmail, executionFailedEmail, outcomeReadyEmail, taskCompletedEmail, taskFailedEmail } from "../email/templates";

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


async function recipient(userId: string | null) {
  if (!userId || !config.email.enabled) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, isGuest: true, emailOnTaskDone: true } });
  if (!u || u.isGuest || !u.emailOnTaskDone || !u.email || u.email.endsWith("@guest.invalid")) return null;
  return u;
}

const OUTCOME_LABEL: Record<string, string> = {
  ACHIEVED: "Achieved",
  PARTIALLY_ACHIEVED: "Partially achieved",
  NOT_ACHIEVED: "Not achieved",
  UNKNOWN: "Not measured",
};
const VERIFICATION_LABEL: Record<string, string> = { PASS: "passed", PASS_WITH_WARNINGS: "passed with warnings", FAIL: "failed (accepted)" };

export async function onExecutionSettled(executionId: string): Promise<void> {
  try {
    const ex = await prisma.execution.findUnique({
      where: { id: executionId },
      select: {
        status: true,
        result: true,
        triggeredById: true,
        outcomeStatus: true,
        verificationStatus: true,
        refundedCents: true,
        errorMessage: true,
        objective: { select: { id: true, title: true } },
      },
    });
    if (!ex) return;
    const u = await recipient(ex.triggeredById);
    if (!u) return;
    if (ex.status === "COMPLETED") {
      await sendEmail({
        to: u.email,
        ...outcomeReadyEmail({
          name: u.name,
          objectiveId: ex.objective.id,
          title: ex.objective.title,
          result: ex.result,
          outcomeLabel: OUTCOME_LABEL[ex.outcomeStatus ?? "UNKNOWN"],
          verificationLabel: VERIFICATION_LABEL[ex.verificationStatus ?? ""] ?? "not run",
        }),
      });
    } else if (ex.status === "FAILED") {
      await sendEmail({
        to: u.email,
        ...executionFailedEmail({ name: u.name, objectiveId: ex.objective.id, title: ex.objective.title, refundedCents: ex.refundedCents, reason: ex.errorMessage ?? "an unexpected error" }),
      });
    }
  } catch (err) {
    console.warn(`[notify] execution ${executionId}:`, err instanceof Error ? err.message : err);
  }
}

export async function onAttentionNeeded(executionId: string, headline: string, detail: string): Promise<void> {
  try {
    const ex = await prisma.execution.findUnique({ where: { id: executionId }, select: { triggeredById: true, objective: { select: { id: true, title: true } } } });
    if (!ex) return;
    const u = await recipient(ex.triggeredById);
    if (!u) return;
    await sendEmail({ to: u.email, ...attentionEmail({ name: u.name, objectiveId: ex.objective.id, title: ex.objective.title, headline, detail }) });
  } catch (err) {
    console.warn(`[notify] attention ${executionId}:`, err instanceof Error ? err.message : err);
  }
}
