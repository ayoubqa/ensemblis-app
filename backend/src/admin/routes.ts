// Owner dashboard (operations view of this deployment). Only for signed-in
// accounts whose email is listed in ADMIN_EMAILS AND has been verified
// (see lib/serializers.ts: an unverified address could belong to anyone who
// signed up with it). Everyone else gets 403 — there is no demo console.
// GET /api/admin/overview -> AdminOverview
// GET /api/admin/economics?days=30&margin=0.75 -> internal unit economics (billing/economics.ts)
// GET /api/admin/executions/:id/economics -> one execution's credits, variable cost and margin
// GET /api/admin/validation?days=30 -> market-validation metrics (admin/validation.ts)

import { Router } from "express";
import type { NextFunction, Response } from "express";
import { prisma } from "../db";
import { config, isAdminEmail } from "../config";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { ah } from "../lib/http";
import { globalRunsToday, startOfTodayUTC } from "../lib/usageLimits";
import { aiProviderLabel } from "../ai/llmProvider";
import { queueStats } from "../engine/queue";
import { effectiveSearchProvider, searchProviderLabel } from "../research/search";
import { reconcileWallets } from "../lib/ledger";
import { economicsSummary, executionEconomics } from "../billing/economics";
import { premiumStatus } from "../ai/premium";
import { validationMetrics } from "./validation";
import { HttpError } from "../lib/http";

const router = Router();

/**
 * The daily search budget only counts successful paid-provider (Tavily) calls; Wikipedia is free.
 * Match it here, using the provider actually in use (Tavily without a key means Wikipedia).
 */
function searchBudgetFilter(): { provider?: string; ok?: boolean } {
  return effectiveSearchProvider() === "tavily" ? { provider: "tavily", ok: true } : {};
}

/** Must run after requireAuth. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  prisma.user
    .findUnique({ where: { id: req.userId }, select: { email: true, isGuest: true, emailVerifiedAt: true } })
    .then((u) => {
      if (!u) return res.status(401).json({ error: "This account no longer exists. Please sign in again." });
      if (u.isGuest || !isAdminEmail(u.email)) {
        return res.status(403).json({ error: "The owner dashboard is only available to this deployment's operators." });
      }
      if (!u.emailVerifiedAt) {
        return res.status(403).json({ error: "Verify your email address (Settings → Account) to open the owner dashboard." });
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

  const [
    usersTotal,
    guests,
    signupRows,
    orgs,
    execGroups,
    completedRows,
    failedRows,
    verificationGroups,
    openExceptions,
    pendingApprovals,
    runsToday,
    llmCallsToday,
    llmFailuresToday,
    llmTokensToday,
    llmRows,
    searchToday,
    searchMonth,
    emailsToday,
    purchases,
    topups,
    legacyTasks,
    queue,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isGuest: true } }),
    prisma.user.findMany({ where: { isGuest: false, createdAt: { gte: since14 } }, select: { createdAt: true } }),
    prisma.organization.count(),
    prisma.execution.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.execution.findMany({ where: { status: "COMPLETED", completedAt: { gte: since14 } }, select: { completedAt: true } }),
    prisma.execution.findMany({ where: { status: "FAILED", createdAt: { gte: since14 } }, select: { createdAt: true } }),
    prisma.execution.groupBy({ by: ["verificationStatus"], where: { status: "COMPLETED" }, _count: { _all: true } }),
    prisma.exception.count({ where: { status: "OPEN" } }),
    prisma.approval.count({ where: { status: "PENDING" } }),
    globalRunsToday(today),
    prisma.usageEvent.count({ where: { kind: "llm", createdAt: { gte: today } } }),
    prisma.usageEvent.count({ where: { kind: "llm", ok: false, createdAt: { gte: today } } }),
    prisma.usageEvent.aggregate({ where: { kind: "llm", createdAt: { gte: today } }, _sum: { tokensIn: true, tokensOut: true } }),
    prisma.usageEvent.findMany({ where: { kind: "llm", createdAt: { gte: since14 } }, select: { createdAt: true, tokensIn: true, tokensOut: true } }),
    prisma.usageEvent.count({ where: { kind: "search", ...searchBudgetFilter(), createdAt: { gte: today } } }),
    prisma.usageEvent.count({ where: { kind: "search", ...searchBudgetFilter(), createdAt: { gte: monthStart } } }),
    prisma.usageEvent.count({ where: { kind: "email", ok: true, createdAt: { gte: today } } }),
    prisma.stripePayment.aggregate({ where: { status: "completed" }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.transaction.aggregate({ where: { type: "TOP_UP" }, _sum: { amountCents: true } }),
    prisma.task.count({ where: { isTest: false } }),
    queueStats(),
  ]);
  const ledger = await reconcileWallets(prisma, 5);

  const [failures, recentUsers] = await Promise.all([
    prisma.execution.findMany({
      where: { status: "FAILED" },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: { id: true, objectiveId: true, errorMessage: true, completedAt: true, createdAt: true, objective: { select: { title: true } } },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, name: true, email: true, isGuest: true, emailVerifiedAt: true, createdAt: true },
    }),
  ]);
  const byStatus = new Map(execGroups.map((g) => [g.status, g._count._all]));
  const byVerification = new Map(verificationGroups.map((g) => [g.verificationStatus ?? "NONE", g._count._all]));

  return {
    generatedAt: now.toISOString(),
    users: { total: usersTotal, guests, organizations: orgs, signupsLast14d: bucketByDay(days, signupRows, (r) => r.createdAt) },
    executions: {
      total: execGroups.reduce((n, g) => n + g._count._all, 0),
      completed: byStatus.get("COMPLETED") ?? 0,
      failed: byStatus.get("FAILED") ?? 0,
      cancelled: byStatus.get("CANCELLED") ?? 0,
      inFlight: (byStatus.get("PLANNING") ?? 0) + (byStatus.get("RUNNING") ?? 0) + (byStatus.get("VERIFYING") ?? 0),
      waiting: (byStatus.get("WAITING_FOR_APPROVAL") ?? 0) + (byStatus.get("BLOCKED") ?? 0),
      verification: { pass: byVerification.get("PASS") ?? 0, warnings: byVerification.get("PASS_WITH_WARNINGS") ?? 0, failedAccepted: byVerification.get("FAIL") ?? 0 },
      openExceptions,
      pendingApprovals,
      runsToday,
      dailyCapGlobal: config.maxTasksPerDayGlobal,
      completedLast14d: bucketByDay(days, completedRows, (r) => r.completedAt),
      failedLast14d: bucketByDay(days, failedRows, (r) => r.createdAt),
      legacyTasks,
    },
    queue,
    ai: {
      providerLabel: aiProviderLabel(),
      callsToday: llmCallsToday,
      failuresToday: llmFailuresToday,
      tokensInToday: llmTokensToday._sum.tokensIn ?? 0,
      tokensOutToday: llmTokensToday._sum.tokensOut ?? 0,
      tokensLast14d: bucketByDay(days, llmRows, (r) => r.createdAt, (r) => r.tokensIn + r.tokensOut),
      premium: await premiumStatus(),
    },
    search: { providerLabel: searchProviderLabel(), callsToday: searchToday, callsThisMonth: searchMonth, dailyBudget: config.search.dailyBudget },
    email: { enabled: config.email.enabled, sentToday: emailsToday },
    money: { purchasesCents: purchases._sum.amountCents ?? 0, purchasesCount: purchases._count._all, demoTopupsCents: topups._sum.amountCents ?? 0 },
    // Every wallet's balance must equal the sum of its ledger rows (lib/ledger.ts).
    ledger: { walletsChecked: ledger.checked, mismatches: ledger.mismatchCount, sample: ledger.mismatches.map((m) => ({ walletUserId: m.walletUserId, balance: m.balance, ledgerSum: m.ledgerSum })) },
    recentFailures: failures.map((f) => ({
      executionId: f.id,
      objectiveId: f.objectiveId,
      title: f.objective.title,
      error: f.errorMessage ?? "Unknown error",
      at: (f.completedAt ?? f.createdAt).toISOString(),
    })),
    recentUsers: recentUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, isGuest: u.isGuest, verified: !!u.emailVerifiedAt, createdAt: u.createdAt.toISOString() })),
  };
}

function numberParam(raw: unknown, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Expected a number between ${min} and ${max}`);
  return n;
}

router.get(
  "/economics",
  ah<AuthedRequest>(async (req, res) => {
    const days = Math.round(numberParam(req.query.days, 30, 1, 365));
    const margin = numberParam(req.query.margin, 0.75, 0, 0.95);
    res.set("Cache-Control", "no-store");
    res.json(await economicsSummary(days, margin));
  })
);

router.get(
  "/validation",
  ah<AuthedRequest>(async (req, res) => {
    const days = Math.round(numberParam(req.query.days, 30, 1, 365));
    res.set("Cache-Control", "no-store");
    res.json(await validationMetrics(days));
  })
);

router.get(
  "/executions/:id/economics",
  ah<AuthedRequest>(async (req, res) => {
    const margin = numberParam(req.query.margin, 0.75, 0, 0.95);
    const e = await executionEconomics(String(req.params.id).slice(0, 64), margin);
    if (!e) throw new HttpError(404, "Execution not found");
    res.set("Cache-Control", "no-store");
    res.json(e);
  })
);

router.get(
  "/overview",
  ah<AuthedRequest>(async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await adminOverview());
  })
);

export default router;
