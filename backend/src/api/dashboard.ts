// /api/dashboard — the Chief of Staff briefing; /api/dashboard/attention — header badges.

import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { ah } from "../lib/http";
import { requireOrg, type OrgRequest } from "../org/organization";
import { getExecutive } from "../org/registry";
import { contextCompleteness, getCompanyContext } from "../context/service";
import { spendableBalance } from "../lib/wallet";
import { toPublicApproval, toPublicEvent, toPublicException } from "../engine/serialize";

const router = Router();
router.use(requireAuth, requireOrg);

const startOfMonthUTC = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

async function netExecutionSpend(orgId: string, since?: Date) {
  const agg = await prisma.transaction.aggregate({
    where: { execution: { orgId }, type: { in: ["TASK_CHARGE", "REFUND"] }, ...(since ? { createdAt: { gte: since } } : {}) },
    _sum: { amountCents: true },
  });
  return Math.max(0, -(agg._sum.amountCents ?? 0));
}

router.get(
  "/attention",
  ah<OrgRequest>(async (req, res) => {
    const orgId = req.org!.orgId;
    const [approvals, exceptions, running] = await Promise.all([
      prisma.approval.count({ where: { orgId, status: "PENDING" } }),
      prisma.exception.count({ where: { orgId, status: "OPEN" } }),
      prisma.execution.count({ where: { orgId, status: { in: ["PLANNING", "RUNNING", "VERIFYING"] } } }),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ approvals, exceptions, running });
  })
);

router.get(
  "/",
  ah<OrgRequest>(async (req, res) => {
    const org = req.org!;
    const orgId = org.orgId;
    const monthStart = startOfMonthUTC();
    const since30 = new Date(Date.now() - 30 * 24 * 3600_000);
    const [user, statusCounts, approvals, exceptions, working, events, recent, ctx, balance, monthSpend, execMonth, value] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: org.userId }, select: { name: true } }),
      prisma.objective.groupBy({ by: ["status"], where: { orgId }, _count: { _all: true } }),
      prisma.approval.findMany({ where: { orgId, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 5, include: { objective: { select: { title: true } } } }),
      prisma.exception.findMany({ where: { orgId, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 5, include: { objective: { select: { title: true } } } }),
      prisma.executionStep.findMany({
        where: { status: "RUNNING", execution: { orgId } },
        select: { title: true, agent: true, executive: true, startedAt: true, execution: { select: { objectiveId: true, objective: { select: { title: true } } } } },
        take: 10,
      }),
      prisma.executionEvent.findMany({ where: { orgId }, orderBy: { id: "desc" }, take: 12, include: { execution: { select: { objectiveId: true, objective: { select: { title: true } } } } } }),
      prisma.execution.findMany({
        where: { orgId, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 5,
        select: { id: true, objectiveId: true, completedAt: true, costCents: true, refundedCents: true, outcomeStatus: true, outcomeSummary: true, verificationStatus: true, verificationScore: true, objective: { select: { title: true } } },
      }),
      getCompanyContext(orgId),
      spendableBalance(org.userId),
      netExecutionSpend(orgId, monthStart),
      prisma.execution.count({ where: { orgId, chargedAt: { gte: monthStart } } }),
      prisma.valueRecord.groupBy({ by: ["metric"], where: { orgId, createdAt: { gte: since30 } }, _sum: { value: true } }),
    ]);
    const tally = (...s: string[]) => statusCounts.filter((c) => s.includes(c.status)).reduce((n, c) => n + c._count._all, 0);
    const v = new Map(value.map((x) => [x.metric, x._sum.value ?? 0]));
    res.set("Cache-Control", "no-store");
    res.json({
      greetingName: user.name.split(" ")[0] || user.name,
      orgName: org.orgName,
      objectives: {
        active: tally("PLANNING", "PLANNED", "WAITING_FOR_APPROVAL", "RUNNING", "VERIFYING", "BLOCKED"),
        running: tally("PLANNING", "RUNNING", "VERIFYING"),
        blocked: tally("BLOCKED"),
        waiting: tally("WAITING_FOR_APPROVAL"),
        completed: tally("COMPLETED"),
        drafts: tally("DRAFT"),
        total: statusCounts.reduce((n, c) => n + c._count._all, 0),
      },
      attention: {
        approvals: approvals.map((a) => toPublicApproval(a, a.objective.title)),
        exceptions: exceptions.map((x) => toPublicException(x, x.objective.title)),
      },
      team: {
        working: working.map((w) => ({
          executive: w.executive,
          executiveTitle: getExecutive(w.executive)?.title ?? w.executive,
          agent: w.agent,
          stepTitle: w.title,
          objectiveId: w.execution.objectiveId,
          objectiveTitle: w.execution.objective.title,
          startedAt: w.startedAt?.toISOString() ?? null,
        })),
        activity: events.map((e) => ({ ...toPublicEvent(e), objectiveId: e.execution.objectiveId, objectiveTitle: e.execution.objective.title })),
      },
      usage: {
        balanceCents: balance.credits,
        walletOwner: balance.walletOwner,
        monthSpendCents: monthSpend,
        executionsThisMonth: execMonth,
      },
      recentOutcomes: recent.map((r) => ({
        executionId: r.id,
        objectiveId: r.objectiveId,
        objectiveTitle: r.objective.title,
        completedAt: r.completedAt?.toISOString() ?? null,
        costCents: r.costCents - r.refundedCents,
        outcomeStatus: r.outcomeStatus,
        outcomeSummary: r.outcomeSummary,
        verificationStatus: r.verificationStatus,
        verificationScore: r.verificationScore,
      })),
      context: contextCompleteness(ctx),
      value30d: {
        criteriaMet: v.get("criteria_met") ?? 0,
        estimatedHoursReturned: Math.round((v.get("estimated_hours_returned") ?? 0) * 10) / 10, // planner estimates, labelled as such in the UI
        executionCostCents: v.get("execution_cost") ?? 0,
      },
    });
  })
);

export default router;
