// Owner dashboard (v3). Only for signed-in accounts whose email is listed in
// ADMIN_EMAILS; everyone else gets 403.
// GET    /api/admin/overview        -> AdminOverview
// POST   /api/admin/gallery         -> { item }  (feature a shared report)
// DELETE /api/admin/gallery/:slug   -> { ok }    (unfeature / hide an example)

import { randomBytes } from "crypto";
import { Router } from "express";
import type { NextFunction, Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { config, isAdminEmail, searchProviderLabel } from "../config";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { globalRunsToday, startOfTodayUTC } from "../lib/usageLimits";
import {
  GALLERY_LIST_SELECT,
  asDepth,
  toPublicGalleryItem,
  toPublicGalleryListItem,
  toSharedSource,
} from "../lib/serializers";
import { aiProviderLabel } from "../tasks/llmProvider";
import { slugify } from "../catalog/agents";
import { summarizeReport } from "../email/templates";

const router = Router();

/** The daily search budget only counts paid-provider (Tavily) calls; Wikipedia is free. Match it here. */
function searchBudgetFilter(): { provider?: string } {
  return config.search.provider === "tavily" ? { provider: "tavily" } : {};
}

/** Must run after requireAuth. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  prisma.user
    .findUnique({ where: { id: req.userId }, select: { email: true, isGuest: true } })
    .then((u) => {
      if (!u) return res.status(401).json({ error: "This account no longer exists. Please sign in again." });
      if (u.isGuest || !isAdminEmail(u.email)) {
        return res.status(403).json({ error: "The owner dashboard is only available to this site's owner." });
      }
      next();
    })
    .catch(next);
}

router.use(requireAuth, requireAdmin);

const DAY_MS = 24 * 3600_000;

/** The last `n` UTC days, oldest first, as "YYYY-MM-DD". */
export function lastDays(n: number, now = new Date()): string[] {
  const today = startOfTodayUTC(now).getTime();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(today - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

/** Buckets rows into the given UTC days (zero-filled). */
export function bucketByDay<T>(days: string[], rows: T[], dateOf: (r: T) => Date | null, weightOf: (r: T) => number = () => 1) {
  const map = new Map(days.map((d) => [d, 0]));
  for (const r of rows) {
    const d = dateOf(r);
    if (!d) continue;
    const key = d.toISOString().slice(0, 10);
    if (map.has(key)) map.set(key, map.get(key)! + weightOf(r));
  }
  return days.map((day) => ({ day, count: map.get(day)! }));
}

export async function adminOverview(now = new Date()) {
  const today = startOfTodayUTC(now);
  const days = lastDays(14, now);
  const since14 = new Date(`${days[0]}T00:00:00.000Z`);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const real: Prisma.TaskWhereInput = { isTest: false };

  const [
    usersTotal,
    guests,
    developers,
    signupRows,
    tasksTotal,
    tasksCompleted,
    tasksFailed,
    tasksRunning,
    runsToday,
    completedRows,
    failedRows,
    llmCallsToday,
    llmFailuresToday,
    llmTokensToday,
    llmRows,
    searchToday,
    searchMonth,
    emailsToday,
    purchases,
    topups,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isGuest: true } }),
    prisma.user.count({ where: { accountType: "DEVELOPER", isGuest: false } }),
    prisma.user.findMany({ where: { isGuest: false, createdAt: { gte: since14 } }, select: { createdAt: true } }),
    prisma.task.count({ where: real }),
    prisma.task.count({ where: { ...real, status: "COMPLETED" } }),
    prisma.task.count({ where: { ...real, status: { in: ["FAILED", "REFUNDED"] } } }),
    prisma.task.count({ where: { status: { in: ["RUNNING", "PLANNING"] } } }),
    globalRunsToday(today),
    prisma.task.findMany({ where: { ...real, status: "COMPLETED", completedAt: { gte: since14 } }, select: { completedAt: true } }),
    prisma.task.findMany({
      where: { ...real, status: { in: ["FAILED", "REFUNDED"] }, createdAt: { gte: since14 } },
      select: { createdAt: true },
    }),
    prisma.usageEvent.count({ where: { kind: "llm", createdAt: { gte: today } } }),
    prisma.usageEvent.count({ where: { kind: "llm", ok: false, createdAt: { gte: today } } }),
    prisma.usageEvent.aggregate({ where: { kind: "llm", createdAt: { gte: today } }, _sum: { tokensIn: true, tokensOut: true } }),
    prisma.usageEvent.findMany({
      where: { kind: "llm", createdAt: { gte: since14 } },
      select: { createdAt: true, tokensIn: true, tokensOut: true },
    }),
    prisma.usageEvent.count({ where: { kind: "search", ...searchBudgetFilter(), createdAt: { gte: today } } }),
    prisma.usageEvent.count({ where: { kind: "search", ...searchBudgetFilter(), createdAt: { gte: monthStart } } }),
    prisma.usageEvent.count({ where: { kind: "email", ok: true, createdAt: { gte: today } } }),
    prisma.stripePayment.aggregate({ where: { status: "completed" }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.transaction.aggregate({ where: { type: "TOP_UP" }, _sum: { amountCents: true } }),
  ]);

  // Top agents by runs (lead agent, real tasks only) + their "Achieved" rate.
  const grouped = await prisma.task.groupBy({
    by: ["agentId"],
    where: { ...real, agentId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { agentId: "desc" } },
    take: 8,
  });
  const agentIds = grouped.map((g) => g.agentId).filter((x): x is string => !!x);
  const [agentRows, outcomeRows] = agentIds.length
    ? await Promise.all([
        prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }),
        prisma.task.groupBy({
          by: ["agentId", "outcome"],
          where: { ...real, agentId: { in: agentIds }, outcome: { not: null } },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const names = new Map(agentRows.map((a) => [a.id, a.name]));
  const topAgents = grouped
    .filter((g) => g.agentId && names.has(g.agentId))
    .map((g) => {
      const rated = outcomeRows.filter((o) => o.agentId === g.agentId);
      const total = rated.reduce((n, o) => n + o._count._all, 0);
      const achieved = rated.filter((o) => o.outcome === "Achieved").reduce((n, o) => n + o._count._all, 0);
      return {
        agentId: g.agentId!,
        name: names.get(g.agentId!)!,
        runs: g._count._all,
        achievedRate: total ? Math.round((achieved / total) * 1000) / 10 : null,
      };
    });

  const [failures, recentUsers, shared, gallery] = await Promise.all([
    prisma.task.findMany({
      where: { status: { in: ["FAILED", "REFUNDED"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, errorMessage: true, createdAt: true, startedAt: true, completedAt: true },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        name: true,
        email: true,
        isGuest: true,
        accountType: true,
        createdAt: true,
        _count: { select: { tasks: true } },
      },
    }),
    prisma.task.findMany({
      where: { status: "COMPLETED", shareToken: { not: null } },
      orderBy: [{ sharedAt: "desc" }, { completedAt: "desc" }],
      take: 50,
      select: { id: true, title: true, shareToken: true, completedAt: true, galleryItems: { select: { id: true }, take: 1 } },
    }),
    prisma.galleryItem.findMany({
      where: { isPublished: true },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      select: GALLERY_LIST_SELECT,
    }),
  ]);

  const label = aiProviderLabel();
  return {
    generatedAt: now.toISOString(),
    users: {
      total: usersTotal,
      guests,
      developers,
      signupsLast14d: bucketByDay(days, signupRows, (r) => r.createdAt),
    },
    tasks: {
      total: tasksTotal,
      completed: tasksCompleted,
      failed: tasksFailed,
      running: tasksRunning,
      runsToday,
      dailyCapGlobal: config.maxTasksPerDayGlobal,
      completedLast14d: bucketByDay(days, completedRows, (r) => r.completedAt),
      failedLast14d: bucketByDay(days, failedRows, (r) => r.createdAt),
    },
    ai: {
      providerLabel: label,
      callsToday: llmCallsToday,
      failuresToday: llmFailuresToday,
      tokensInToday: llmTokensToday._sum.tokensIn ?? 0,
      tokensOutToday: llmTokensToday._sum.tokensOut ?? 0,
      tokensLast14d: bucketByDay(days, llmRows, (r) => r.createdAt, (r) => r.tokensIn + r.tokensOut),
    },
    search: {
      providerLabel: searchProviderLabel(),
      callsToday: searchToday,
      callsThisMonth: searchMonth,
      dailyBudget: config.search.dailyBudget,
    },
    email: { enabled: config.email.enabled, sentToday: emailsToday },
    money: {
      purchasesCents: purchases._sum.amountCents ?? 0,
      purchasesCount: purchases._count._all,
      demoTopupsCents: topups._sum.amountCents ?? 0,
    },
    topAgents,
    recentFailures: failures.map((t) => ({
      taskId: t.id,
      title: t.title,
      error: t.errorMessage ?? "Unknown error",
      at: (t.completedAt ?? t.startedAt ?? t.createdAt).toISOString(),
    })),
    recentUsers: recentUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isGuest: u.isGuest,
      accountType: u.accountType,
      createdAt: u.createdAt.toISOString(),
      tasks: u._count.tasks,
    })),
    shareableReports: shared.map((t) => ({
      taskId: t.id,
      title: t.title,
      shareToken: t.shareToken!,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      featured: t.galleryItems.length > 0,
    })),
    gallery: gallery.map(toPublicGalleryListItem),
  };
}

router.get(
  "/overview",
  ah<AuthedRequest>(async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await adminOverview());
  })
);

const featureSchema = z.object({
  taskId: z.string().trim().min(1, "taskId is required").max(64),
  title: z.string().trim().min(3, "Title is too short").max(160).optional(),
  summary: z.string().trim().min(10, "Summary is too short").max(600).optional(),
});

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…");

/** Snapshots a completed, publicly shared report into the gallery as a featured (non-example) item. */
export async function featureTask(input: z.infer<typeof featureSchema>) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    include: {
      agent: { select: { name: true, category: true } },
      sources: { orderBy: { n: "asc" } },
      steps: { orderBy: { order: "asc" }, take: 1, select: { agentName: true } },
      revisions: { where: { status: "COMPLETED" }, orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!task) throw new HttpError(404, "Task not found");
  if (task.status !== "COMPLETED") throw new HttpError(409, "Only completed reports can be featured");
  // Privacy: only reports their owner already made public can be featured.
  if (!task.shareToken) throw new HttpError(409, "Only reports their owner has shared publicly can be featured");
  if (await prisma.galleryItem.findFirst({ where: { taskId: task.id }, select: { id: true } })) {
    throw new HttpError(409, "This report is already in the gallery");
  }
  const content = task.revisions[0]?.result ?? task.result;
  if (!content?.trim()) throw new HttpError(409, "This report has no content to feature");

  const title = input.title ?? clip(task.title, 160);
  const summary = input.summary ?? (clip(summarizeReport(content, 2).join(" "), 300) || title);
  const slug = `${(slugify(title).slice(0, 60).replace(/-+$/, "") || "report")}-${randomBytes(3).toString("hex")}`;
  const item = await prisma.galleryItem.create({
    data: {
      slug,
      title,
      category: task.category ?? task.agent?.category ?? "Research",
      summary,
      content,
      sources: task.sources.map(toSharedSource) as unknown as Prisma.InputJsonValue, // no uploaded-file text in public
      agentName: task.agent?.name ?? task.steps[0]?.agentName ?? "Ensemblis team",
      depth: asDepth(task.depth),
      isExample: false,
      taskId: task.id,
      position: 0,
      isPublished: true,
    },
  });
  return toPublicGalleryItem(item, true);
}

router.post(
  "/gallery",
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(featureSchema, req.body);
    res.status(201).json({ item: await featureTask(body) });
  })
);

// Featured reports are removed; curated examples are hidden (isPublished=false)
// so a re-seed doesn't bring them back.
router.delete(
  "/gallery/:slug",
  ah<AuthedRequest>(async (req, res) => {
    const item = await prisma.galleryItem.findUnique({ where: { slug: req.params.slug } });
    if (!item) throw new HttpError(404, "Gallery item not found");
    if (item.isExample) {
      await prisma.galleryItem.update({ where: { id: item.id }, data: { isPublished: false } });
    } else {
      await prisma.galleryItem.delete({ where: { id: item.id } });
    }
    res.json({ ok: true });
  })
);

export default router;
