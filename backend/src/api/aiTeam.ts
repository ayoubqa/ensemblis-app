// /api/ai-team — the AI organization: executives, their capabilities and
// specialists, the tools each may use (with permission levels), and what the
// team is doing right now for this organization.

import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { ah } from "../lib/http";
import { requireOrg, type OrgRequest } from "../org/organization";
import { CAPABILITIES, EXECUTIVES, REGISTRY_VERSION, VERIFICATION_COST_CENTS } from "../org/registry";
import { DEFAULT_TOOL_GRANTS } from "../org/policy";
import { TOOLS, TOOL_PERMISSION_LEVELS } from "../org/tools";

const router = Router();
router.use(requireAuth, requireOrg);

router.get(
  "/",
  ah<OrgRequest>(async (req, res) => {
    const orgId = req.org!.orgId;
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const [runs, working] = await Promise.all([
      prisma.executionStep.groupBy({
        by: ["capability"],
        where: { status: "COMPLETED", completedAt: { gte: since }, execution: { orgId } },
        _count: { _all: true },
      }),
      prisma.executionStep.findMany({
        where: { status: "RUNNING", execution: { orgId } },
        select: { title: true, agent: true, executive: true, capability: true, startedAt: true, execution: { select: { objectiveId: true, objective: { select: { title: true } } } } },
        take: 50,
      }),
    ]);
    const runsBy = new Map(runs.map((r) => [r.capability, r._count._all]));
    res.json({
      version: REGISTRY_VERSION,
      verificationCostCents: VERIFICATION_COST_CENTS,
      executives: EXECUTIVES.map((e) => ({
        ...e,
        capabilities: CAPABILITIES.filter((c) => c.executive === e.key).map((c) => ({
          key: c.key,
          name: c.name,
          version: c.version,
          kind: c.kind,
          specialist: c.specialist,
          description: c.description,
          methodology: c.methodology,
          deliverable: c.deliverable,
          verificationFocus: c.verificationFocus,
          tools: c.tools.map((t) => ({ key: t, name: TOOLS[t].name, permission: TOOLS[t].permission })),
          costCents: c.costCents,
          completedLast30d: runsBy.get(c.key) ?? 0,
        })),
        working: working
          .filter((w) => w.executive === e.key)
          .map((w) => ({
            stepTitle: w.title,
            agent: w.agent,
            capability: w.capability,
            objectiveId: w.execution.objectiveId,
            objectiveTitle: w.execution.objective.title,
            startedAt: w.startedAt?.toISOString() ?? null,
          })),
      })),
      tools: Object.values(TOOLS),
      policy: {
        granted: DEFAULT_TOOL_GRANTS,
        notGranted: TOOL_PERMISSION_LEVELS.filter((p) => !DEFAULT_TOOL_GRANTS.includes(p)),
        note: "The AI Team researches, analyses, drafts and recommends. It never sends email, publishes, changes external systems or spends money.",
      },
    });
  })
);

export default router;
