import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireDeveloper, AuthedRequest } from "../auth/middleware";
import { ah, parse } from "../lib/http";
import { taskRunLimiter } from "../lib/rateLimits";
import { startOfTodayUTC } from "../lib/usageLimits";
import { toPublicAgent } from "../lib/serializers";
import { config } from "../config";
import { createTestRun } from "../tasks/service";

const router = Router();
router.use(requireAuth, requireDeveloper);

const PLATFORM_FEE_PERCENT = 20;
const devShare = (cents: number) => Math.round((cents * (100 - PLATFORM_FEE_PERCENT)) / 100);
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// Revenue for a developer = 80% of the price of COMPLETED tasks whose lead
// agent they own. Free test runs (isTest) never count.
router.get(
  "/stats",
  ah<AuthedRequest>(async (req, res) => {
    const agents = await prisma.agent.findMany({ where: { ownerId: req.userId }, orderBy: { createdAt: "desc" } });
    const ids = agents.map((a) => a.id);
    const [tasks, testRunsToday] = await Promise.all([
      ids.length
        ? prisma.task.findMany({
            where: { agentId: { in: ids }, status: "COMPLETED", isTest: false },
            select: { agentId: true, costCents: true, completedAt: true, createdAt: true, outcome: true },
          })
        : Promise.resolve([]),
      prisma.task.count({ where: { userId: req.userId, isTest: true, createdAt: { gte: startOfTodayUTC() } } }),
    ]);

    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
    const monthly = new Map(months.map((m) => [m, { month: m, revenueCents: 0, tasks: 0 }]));

    const perAgent = new Map(ids.map((id) => [id, { revenueCents: 0, tasksRun: 0, rated: 0, achieved: 0 }]));
    for (const t of tasks) {
      const a = perAgent.get(t.agentId!);
      if (!a) continue;
      const share = devShare(t.costCents);
      a.revenueCents += share;
      a.tasksRun += 1;
      if (t.outcome) {
        a.rated += 1;
        if (t.outcome === "Achieved") a.achieved += 1;
      }
      const bucket = monthly.get(monthKey(t.completedAt ?? t.createdAt));
      if (bucket) {
        bucket.revenueCents += share;
        bucket.tasks += 1;
      }
    }

    const agentStats = agents.map((agent) => {
      const s = perAgent.get(agent.id)!;
      return {
        ...toPublicAgent(agent),
        revenueCents: s.revenueCents,
        tasksRun: s.tasksRun,
        achievedRate: s.rated ? Math.round((s.achieved / s.rated) * 1000) / 10 : null,
      };
    });

    res.json({
      agents: agentStats,
      totalRevenueCents: agentStats.reduce((n, a) => n + a.revenueCents, 0),
      totalTasks: agentStats.reduce((n, a) => n + a.tasksRun, 0),
      platformFeePercent: PLATFORM_FEE_PERCENT,
      monthly: [...monthly.values()],
      testRunsToday,
      testRunsPerDay: config.devTestRunsPerDay,
    });
  })
);

const testRunSchema = z.object({
  description: z
    .string({ required_error: "Describe what the test run should do" })
    .trim()
    .min(3, "Describe what the test run should do")
    .max(config.maxDescriptionLength, `Description is too long (max ${config.maxDescriptionLength} characters)`),
});

// v3: free single-agent test run of YOUR agent (config.devTestRunsPerDay per UTC day).
router.post(
  "/agents/:id/test-run",
  taskRunLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const { description } = parse(testRunSchema, req.body);
    const task = await createTestRun(req.userId!, req.params.id, description);
    res.status(201).json({ task });
  })
);

export default router;
