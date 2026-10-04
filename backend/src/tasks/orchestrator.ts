// The heart of Ensemblis: runs a task as a real multi-agent team.
//
// A task's TaskSteps (planned by classify.ts) are executed sequentially. Each
// step calls the model (llmProvider.ts — free local Ollama by default) with:
//   - that agent's own system prompt,
//   - a role-specific instruction (research / analysis / verification / report),
//   - the client's brief, and
//   - the (truncated) outputs of the previous steps.
// The final step's output becomes task.result. Any failure fails the task and
// refunds the client's credits.
//
// Runs in-process (fire-and-forget). Restart-safety is handled by
// recoverInterruptedTasks() on startup; swap in a real job queue once volume
// warrants it.

import type { Agent, TaskStep } from "@prisma/client";
import { prisma } from "../db";
import { runLLM } from "./llmProvider";
import { failAndRefund } from "./service";

const DEFAULT_SYSTEM_PROMPT =
  "You are a skilled analyst completing a work task on behalf of a client. " +
  "Produce a clear, well-structured markdown report with a short executive " +
  "summary followed by detailed sections. Be specific; flag any estimate as " +
  "an estimate rather than presenting it as a verified fact, and never invent citations.";

// Small local models have small context windows; keep what we pass forward bounded.
const PER_STEP_CHARS = Number(process.env.STEP_CONTEXT_CHARS) || 4000;
const TOTAL_CONTEXT_CHARS = PER_STEP_CHARS * 2.5;
const BRIEF_CHARS = 6000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  return (lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut) + "\n\n[… truncated for length …]";
}

const ROLE_INSTRUCTIONS: Record<string, string> = {
  Research:
    "YOUR STEP: RESEARCH. You are the first agent on this team. Gather and structure the facts, entities, figures and open questions the specialist will need. " +
    "Use tables for lists of entities. Give each fact a confidence level and mark estimates. Do not write the final report and do not draw final conclusions — the specialist and report writer come after you. Keep it under ~900 words.",
  Analysis:
    "YOUR STEP: SPECIALIST ANALYSIS. You lead the substantive work on this task. Use the research notes (if any) as input, correct them where they are wrong, and produce the core analysis in your area of expertise, following your output structure. " +
    "Be concrete and decision-useful. Mark every estimate. Keep it under ~1,400 words.",
  Verification:
    "YOUR STEP: VERIFICATION. Critically check the work of the previous agents. Extract the important claims, assess each one (Supported / Plausible but unverified / Unsupported / Inconsistent), flag anything that looks fabricated (citations, URLs, names, quotes, contact details) or any estimate presented as fact, and list the concrete corrections the report writer must apply. " +
    "Do not rewrite the report. Keep it under ~700 words.",
  Report:
    "YOUR STEP: FINAL REPORT. Produce the polished deliverable the client will receive — it must stand on its own and is the only thing they read. " +
    "Start with a `#` title, then `## Executive summary` (4–6 bullets answering the request). Then clear sections with descriptive headings, using markdown tables where they make comparison easier, then `## Recommendations & next steps`, and end with `## Sources & verification notes` listing what the findings rest on, which figures are estimates, and exactly what the client should verify. " +
    "Integrate the specialist's analysis and apply every correction from the verification step if there was one. Do not mention the internal agents or steps. Do not invent citations or URLs.",
};

function buildUserContent(
  task: { title: string; description: string; depth: string },
  step: TaskStep,
  previous: TaskStep[],
  totalSteps: number
): string {
  const parts: string[] = [];
  parts.push(`# Client task\n**Title:** ${task.title}\n**Depth requested:** ${task.depth}\n\n**Brief:**\n${truncate(task.description, BRIEF_CHARS)}`);

  if (previous.length) {
    // Most recent outputs matter most; trim older ones harder if over budget.
    let budget = TOTAL_CONTEXT_CHARS;
    const blocks: string[] = [];
    for (let i = previous.length - 1; i >= 0; i--) {
      const p = previous[i];
      const allowance = Math.max(800, Math.min(PER_STEP_CHARS, budget));
      const body = truncate(p.output ?? "", allowance);
      budget -= body.length;
      blocks.unshift(`## Step ${p.order + 1} — ${p.role} by ${p.agentName}\n${body}`);
    }
    parts.push(`# Work from earlier agents on this team\n${blocks.join("\n\n---\n\n")}`);
  }

  parts.push(
    `# Your assignment (step ${step.order + 1} of ${totalSteps}: ${step.title})\n` +
      (ROLE_INSTRUCTIONS[step.role] ?? ROLE_INSTRUCTIONS.Analysis)
  );
  return parts.join("\n\n");
}

export async function runTaskTeam(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!task || task.status !== "RUNNING") return;

  const agentIds = [...new Set(task.steps.map((s) => s.agentId).filter((x): x is string => !!x))];
  const agents = new Map<string, Agent>(
    (await prisma.agent.findMany({ where: { id: { in: agentIds } } })).map((a) => [a.id, a])
  );

  const done: TaskStep[] = [];
  let current: TaskStep | null = null;
  try {
    if (task.steps.length === 0) throw new Error("This task has no steps to run");

    for (const step of task.steps) {
      current = step;
      // Stop if the task was failed elsewhere (e.g. startup recovery) mid-run.
      const fresh = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
      if (fresh?.status !== "RUNNING") return;

      await prisma.taskStep.update({ where: { id: step.id }, data: { status: "RUNNING", startedAt: new Date() } });

      const agent = step.agentId ? agents.get(step.agentId) : undefined;
      const systemPrompt = agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      const userContent = buildUserContent(task, step, done, task.steps.length);

      const { text } = await runLLM(systemPrompt, userContent);
      const output = text.trim();
      if (!output) throw new Error(`${step.agentName} returned an empty response`);

      const completed = await prisma.taskStep.update({
        where: { id: step.id },
        data: { status: "COMPLETED", output, completedAt: new Date() },
      });
      done.push(completed);
    }

    const final = done[done.length - 1]?.output ?? "";
    await prisma.$transaction(async (tx) => {
      const flipped = await tx.task.updateMany({
        where: { id: taskId, status: "RUNNING" },
        data: { status: "COMPLETED", result: final, completedAt: new Date() },
      });
      if (flipped.count === 0) return;
      if (agentIds.length) {
        await tx.agent.updateMany({ where: { id: { in: agentIds } }, data: { tasksCompleted: { increment: 1 } } });
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Task ${taskId} failed at step ${current ? current.order + 1 : "?"}:`, err);
    if (current) {
      await prisma.taskStep
        .update({
          where: { id: current.id },
          data: { status: "FAILED", completedAt: new Date(), output: `Step failed: ${message}` },
        })
        .catch(() => undefined);
    }
    const prefix = current ? `${current.agentName} (${current.role.toLowerCase()} step) failed: ` : "";
    await failAndRefund(taskId, prefix + message);
  }
}
