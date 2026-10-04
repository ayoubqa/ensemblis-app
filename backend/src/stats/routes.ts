import { Router } from "express";
import { prisma } from "../db";
import { ah } from "../lib/http";
import { sortCategories } from "../agents/routes";

// Public platform numbers for the landing page.
const router = Router();

router.get(
  "/",
  ah(async (_req, res) => {
    const [agents, live, tasksRunning, users, developers] = await Promise.all([
      prisma.agent.count(),
      prisma.agent.findMany({ where: { isLive: true }, select: { category: true, successRate: true, tasksCompleted: true } }),
      prisma.task.count({ where: { status: "RUNNING" } }),
      prisma.user.count(),
      prisma.user.count({ where: { accountType: "DEVELOPER" } }),
    ]);

    // Marketplace-wide completed count = the per-agent counters shown on agent
    // cards (catalog history + every real completed run increments them).
    const tasksCompleted = live.reduce((n, a) => n + a.tasksCompleted, 0);
    const rated = live.filter((a) => a.successRate > 0);
    const avgSuccessRate = rated.length
      ? Math.round((rated.reduce((n, a) => n + a.successRate, 0) / rated.length) * 10) / 10
      : 0;

    const counts = new Map<string, number>();
    live.forEach((a) => counts.set(a.category, (counts.get(a.category) ?? 0) + 1));
    const categories = sortCategories([...counts.keys()]).map((category) => ({ category, agents: counts.get(category)! }));

    res.json({
      agents,
      liveAgents: live.length,
      tasksCompleted,
      tasksRunning,
      users,
      developers,
      avgSuccessRate,
      categories,
    });
  })
);

export default router;
