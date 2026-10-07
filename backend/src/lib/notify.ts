// Called once when a task reaches COMPLETED or FAILED (v3): emails the person
// who started it ("your report is ready" / "your task failed and was
// refunded"). Skipped for guests, developer test runs and users who turned
// task emails off, and a no-op when email isn't configured.
// Never throws — notification problems must not affect the task.

import { config } from "../config";
import { prisma } from "../db";
import { sendEmail } from "../email/send";
import { taskCompletedEmail, taskFailedEmail } from "../email/templates";

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
