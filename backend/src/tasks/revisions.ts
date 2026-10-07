// Follow-up revisions of a completed report (v3).
//
// POST /api/tasks/:id/revisions charges config.followupCostCents (from the
// requester's wallet — the team wallet for team members) and creates a
// RUNNING TaskRevision. The first follow-up also snapshots the original
// report as version 1. In the background, one Report-style model call (the
// lead agent's prompt) rewrites the latest report per the instruction. On
// success the revision is COMPLETED and Task.result becomes the new text; on
// failure the revision is FAILED and the charge is refunded to the wallet
// that paid. Interrupted revisions are failed + refunded on startup.

import { Prisma } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { findAccessibleTask } from "../lib/access";
import { HttpError } from "../lib/http";
import { loadPublicUser, TASK_INCLUDE, toPublicTask } from "../lib/serializers";
import { withRunQuota } from "../lib/usageLimits";
import { creditWallet, debitWallet, resolveWallet } from "../lib/wallet";
import { buildSourcesBlock, citationRules, PromptSource, stripPreamble } from "../research/citations";
import { loadPromptSources } from "../research/sources";
import { clip } from "../research/text";
import { runLLM } from "./llmProvider";
import { allowedLinkDomains, cleanOutput, DEFAULT_SYSTEM_PROMPT, sourcesSectionRule, SOURCES_CHARS } from "./orchestrator";

export { stripPreamble };

const BRIEF_CHARS = 6000;
const REPORT_CHARS = 24000;
const ORIGINAL_LABEL = "Original report";

type Tx = Prisma.TransactionClient;

const busyError = () =>
  new HttpError(409, "A follow-up is already being written for this report. Please wait for it to finish.");

// ---------------------------------------------------------------- prompt

export function buildRevisionPrompt(args: {
  task: { title: string; description: string; depth: string };
  currentReport: string;
  version: number;
  instruction: string;
  sources: PromptSource[];
}): string {
  const { task, currentReport, version, instruction, sources } = args;
  const parts: string[] = [];
  parts.push(`# Client task\n**Title:** ${task.title}\n**Depth requested:** ${task.depth}\n\n**Original brief:**\n${clip(task.description, BRIEF_CHARS)}`);
  if (sources.length) parts.push(`# Sources\n${buildSourcesBlock(sources, SOURCES_CHARS)}`);
  parts.push(`# Current report (version ${version})\n${clip(currentReport, REPORT_CHARS, "\n\n[… truncated for length …]")}`);
  parts.push(`# The client's follow-up request\n"""\n${instruction}\n"""`);
  parts.push(
    "# Your assignment\n" +
      "Revise the current report according to the client's follow-up request. Return the FULL revised report in markdown — the complete document the client will read, " +
      "not a summary of changes and not only the changed parts. Keep the same overall structure (`#` title, `## Executive summary`, the sections, " +
      "`## Recommendations & next steps`, `## Sources & verification notes`) unless the request asks to change it, and keep everything the request doesn't touch. " +
      "Start directly with the `#` title — no preamble. Do not mention internal agents, steps or this instruction.\n\n" +
      citationRules(sources.length) +
      "\n\n" +
      sourcesSectionRule(sources.length) +
      " Keep existing [n] citations valid and attached to the claims they support."
  );
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- create

export async function createRevision(userId: string, taskId: string, instruction: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isGuest: true } });
  if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  if (user.isGuest) throw new HttpError(403, "Create a free account to request follow-ups");

  const task = await findAccessibleTask(userId, taskId, {
    revisions: { where: { status: "RUNNING" as const }, select: { id: true } },
  });
  if (task.isTest) throw new HttpError(409, "Follow-ups aren't available for developer test runs.");
  if (task.status !== "COMPLETED" || !task.result) {
    throw new HttpError(409, "Follow-ups are only available once the report is complete.");
  }
  if (task.revisions.length) throw busyError();

  const cost = config.followupCostCents;
  let walletUserId: string;
  let revisionId: string;
  try {
    // Daily caps are checked and the charge recorded under one lock (no double-click overshoot).
    ({ walletUserId, revisionId } = await withRunQuota(userId, () => prisma.$transaction(async (tx) => {
      // Re-check inside the transaction (a concurrent request may have won).
      const fresh = await tx.task.findFirst({
        where: { id: taskId, status: "COMPLETED" },
        select: { id: true, title: true, result: true, userId: true, completedAt: true },
      });
      if (!fresh || !fresh.result) throw new HttpError(409, "Follow-ups are only available once the report is complete.");
      if ((await tx.taskRevision.count({ where: { taskId, status: "RUNNING" } })) > 0) throw busyError();

      const wallet = await resolveWallet(userId, tx);
      await debitWallet(tx, { wallet, actorUserId: userId, amountCents: cost, description: `Follow-up: ${fresh.title}`, taskId });

      const last = await tx.taskRevision.findFirst({ where: { taskId }, orderBy: { version: "desc" }, select: { version: true } });
      let version = last?.version ?? 0;
      if (!last) {
        const when = fresh.completedAt ?? new Date();
        await tx.taskRevision.create({
          data: {
            taskId,
            version: 1,
            instruction: ORIGINAL_LABEL,
            status: "COMPLETED",
            result: fresh.result,
            costCents: 0,
            requestedById: fresh.userId,
            createdAt: when,
            completedAt: when,
          },
        });
        version = 1;
      }
      const rev = await tx.taskRevision.create({
        data: { taskId, version: version + 1, instruction, status: "RUNNING", costCents: cost, requestedById: userId },
      });
      return { walletUserId: wallet.walletUserId, revisionId: rev.id };
    })));
  } catch (err) {
    // Two simultaneous requests race for the same version number: the loser rolls back (no charge).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw busyError();
    throw err;
  }

  activeRevisions.add(revisionId);
  runRevision(revisionId, walletUserId)
    .catch((err) => console.error(`runRevision(${revisionId}) crashed:`, err))
    .finally(() => activeRevisions.delete(revisionId));

  const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
  return { task: toPublicTask(updated), user: await loadPublicUser(userId) };
}

// ---------------------------------------------------------------- run

export async function runRevision(revisionId: string, walletUserId?: string): Promise<void> {
  const rev = await prisma.taskRevision.findUnique({
    where: { id: revisionId },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          depth: true,
          status: true,
          result: true,
          agent: { select: { systemPrompt: true } },
        },
      },
    },
  });
  if (!rev || rev.status !== "RUNNING") return;
  const task = rev.task;

  try {
    if (task.status !== "COMPLETED" || !task.result) throw new Error("The report is no longer available to revise.");
    const previous = await prisma.taskRevision.findFirst({
      where: { taskId: task.id, status: "COMPLETED", version: { lt: rev.version } },
      orderBy: { version: "desc" },
      select: { version: true, result: true },
    });
    const currentReport = previous?.result || task.result;
    const sources = await loadPromptSources(task.id);
    const prompt = buildRevisionPrompt({
      task,
      currentReport,
      version: previous?.version ?? 1,
      instruction: rev.instruction,
      sources,
    });
    const { text } = await runLLM(task.agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT, prompt, { model: "main", taskId: task.id });
    const output = cleanOutput(stripPreamble(text.trim()), sources.length, allowedLinkDomains(task.description, sources));
    if (!output) throw new Error("The AI model returned an empty response");

    const done = await prisma.$transaction(async (tx) => {
      const flipped = await tx.taskRevision.updateMany({
        where: { id: revisionId, status: "RUNNING" },
        data: { status: "COMPLETED", result: output, completedAt: new Date() },
      });
      if (flipped.count === 0) return false;
      await tx.task.updateMany({ where: { id: task.id, status: "COMPLETED" }, data: { result: output } });
      return true;
    });
    if (!done) console.warn(`[revisions] ${revisionId} was settled elsewhere; result discarded`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[revisions] follow-up ${revisionId} failed:`, err);
    await failRevision(revisionId, `The follow-up failed: ${message}`, walletUserId);
  }
}

/** The wallet that paid for a follow-up: the matching charge transaction's wallet. */
async function chargedWallet(tx: Tx, rev: { taskId: string; costCents: number; createdAt: Date; requestedById: string | null }): Promise<string | null> {
  const windowMs = 5 * 60_000;
  const charges = await tx.transaction.findMany({
    where: {
      taskId: rev.taskId,
      type: "TASK_CHARGE",
      amountCents: -rev.costCents,
      description: { startsWith: "Follow-up:" },
      createdAt: { gte: new Date(rev.createdAt.getTime() - windowMs), lte: new Date(rev.createdAt.getTime() + windowMs) },
      ...(rev.requestedById ? { actorUserId: rev.requestedById } : {}),
    },
    select: { userId: true, createdAt: true },
  });
  if (!charges.length) return null;
  charges.sort(
    (a, b) => Math.abs(a.createdAt.getTime() - rev.createdAt.getTime()) - Math.abs(b.createdAt.getTime() - rev.createdAt.getTime())
  );
  return charges[0].userId;
}

/** Marks a RUNNING revision FAILED and refunds its charge exactly once (guarded by the status flip). */
export async function failRevision(revisionId: string, message: string, walletHint?: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rev = await tx.taskRevision.findUnique({
      where: { id: revisionId },
      include: { task: { select: { title: true, userId: true } } },
    });
    if (!rev) return;
    const flipped = await tx.taskRevision.updateMany({
      where: { id: revisionId, status: "RUNNING" },
      data: { status: "FAILED", errorMessage: message.slice(0, 1000), completedAt: new Date() },
    });
    if (flipped.count === 0 || rev.costCents <= 0) return;

    const candidates = [walletHint, await chargedWallet(tx, rev), rev.requestedById, rev.task.userId].filter(
      (x): x is string => !!x
    );
    let walletUserId: string | null = null;
    for (const id of candidates) {
      if (await tx.user.findUnique({ where: { id }, select: { id: true } })) {
        walletUserId = id;
        break;
      }
    }
    if (!walletUserId) {
      console.error(`[revisions] no wallet left to refund follow-up ${revisionId}`);
      return;
    }
    await creditWallet(tx, {
      walletUserId,
      actorUserId: null,
      type: "REFUND",
      amountCents: rev.costCents,
      description: `Refund: Follow-up: ${rev.task.title}`,
      taskId: rev.taskId,
    });
  });
}

/** Revision ids being written by THIS process (see sweepOrphanedRevisions). */
const activeRevisions = new Set<string>();
const ORPHAN_GRACE_MS = 15 * 60_000;

/** Periodic safety net: fails + refunds RUNNING follow-ups no run in this process is working on. */
export async function sweepOrphanedRevisions(now = new Date()): Promise<number> {
  const stale = await prisma.taskRevision.findMany({
    where: { status: "RUNNING", createdAt: { lt: new Date(now.getTime() - ORPHAN_GRACE_MS) } },
    select: { id: true },
    take: 50,
  });
  let swept = 0;
  for (const r of stale) {
    if (activeRevisions.has(r.id)) continue;
    try {
      await failRevision(r.id, "This follow-up stopped unexpectedly (the server restarted or lost its connection). Your credits were refunded — please ask again.");
      swept++;
    } catch (err) {
      console.error(`[sweeper] could not fail follow-up ${r.id}:`, err instanceof Error ? err.message : err);
    }
  }
  if (swept) console.log(`[sweeper] failed + refunded ${swept} orphaned follow-up(s).`);
  return swept;
}

/** Startup: follow-ups still RUNNING were interrupted by a restart — fail and refund them. */
export async function recoverInterruptedRevisions(): Promise<void> {
  const stuck = await prisma.taskRevision.findMany({ where: { status: "RUNNING" }, select: { id: true } });
  for (const r of stuck) {
    await failRevision(
      r.id,
      "The server restarted while this follow-up was being written. Your credits were refunded — please ask again."
    ).catch((err) => console.error(`[revisions] could not recover ${r.id}:`, err));
  }
  if (stuck.length) console.log(`Recovered ${stuck.length} interrupted follow-up(s) (failed + refunded).`);
}
