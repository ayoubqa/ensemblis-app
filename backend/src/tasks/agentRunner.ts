// This file is the single most important difference between the prototype and
// a real product: instead of a `setTimeout` loop that fakes progress and
// returns canned text, this actually calls a real model to do the work.
//
// Which model is a one-line config choice — see llmProvider.ts. By default
// that's a free local Ollama model, so this runs with $0 cost and no account.
//
// It's intentionally simple (no retries, no streaming, no job queue) so it's
// easy to read end-to-end. See the README for what to add before this runs
// in production (a real job queue, streaming progress, retry/backoff).

import { prisma } from "../db";
import { runLLM } from "./llmProvider";

const DEFAULT_SYSTEM_PROMPT =
  "You are a skilled analyst completing a work task on behalf of a client. " +
  "Produce a clear, well-structured markdown report with a short executive " +
  "summary followed by detailed sections. Be specific; flag any estimate as " +
  "an estimate rather than presenting it as a verified fact.";

// Runs in the background after a task is created. Does not block the HTTP
// response — the client polls GET /api/tasks/:id (or you can upgrade this to
// Server-Sent Events / websockets for live progress) to see when it's done.
export async function runTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { agent: true },
  });
  if (!task) return;

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "RUNNING" },
  });

  try {
    const systemPrompt = task.agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const userContent = `Task: ${task.title}\n\nFull description:\n${task.description}`;

    const { text: resultText } = await runLLM(systemPrompt, userContent);

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        result: resultText,
        completedAt: new Date(),
      },
    });

    if (task.agentId) {
      await prisma.agent.update({
        where: { id: task.agentId },
        data: { tasksCompleted: { increment: 1 } },
      });
    }
  } catch (err) {
    console.error(`Task ${taskId} failed:`, err);
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
      },
    });
    // Refund the credits we charged up front since the task didn't complete.
    await prisma.user.update({
      where: { id: task.userId },
      data: { credits: { increment: task.costCents } },
    });
  }
}
