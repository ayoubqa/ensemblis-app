// Public, unauthenticated read-only pages: GET /api/public/reports/:token
// serves a report its owner chose to share (/r/<token>). Two kinds of token:
//   - legacy task reports (v1–v3), exactly as before;
//   - objective outcomes (v4): the final result with its objective, success
//     criteria, outcome, verification summary and evidence.
// Never exposed: the account, prices, the full objective statement or notes,
// and the text of company documents (their evidence entries stay listed so
// [n] citations still resolve).

import { Router } from "express";
import { prisma } from "../db";
import { ah, HttpError } from "../lib/http";
import { asDepth, toPublicAgent, toSharedSource } from "../lib/serializers";
import { toPublicEvidence } from "../engine/evidence";
import { toPublicCriterion, toPublicMeasurement } from "../engine/serialize";

const router = Router();

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

async function loadTaskReport(token: string) {
  const task = await prisma.task.findFirst({
    where: { shareToken: token, status: "COMPLETED" },
    include: {
      agent: true,
      steps: { orderBy: { order: "asc" }, select: { agentName: true, role: true, title: true, order: true } },
      sources: { orderBy: { n: "asc" } },
      revisions: { where: { status: "COMPLETED" }, orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!task) return null;
  const latest = task.revisions[0];
  return {
    kind: "task" as const,
    token,
    title: task.title,
    category: task.category,
    depth: asDepth(task.depth),
    result: latest?.result ?? task.result ?? "",
    version: latest?.result ? latest.version : 1,
    sources: task.sources.map(toSharedSource),
    completedAt: (latest?.completedAt ?? task.completedAt)?.toISOString() ?? null,
    leadAgent: task.agent ? toPublicAgent(task.agent) : null,
    team: task.steps.map((s) => ({ agentName: s.agentName, role: s.role, title: s.title })),
  };
}

async function loadExecutionReport(token: string) {
  const ex = await prisma.execution.findFirst({
    where: { shareToken: token, status: "COMPLETED" },
    include: {
      objective: { include: { criteria: { orderBy: { order: "asc" } } } },
      evidence: { orderBy: { n: "asc" } },
      verifications: { orderBy: { round: "desc" }, take: 1 },
      measurements: true,
      steps: { orderBy: { order: "asc" }, select: { title: true, agent: true, executive: true, status: true, kind: true } },
    },
  });
  if (!ex) return null;
  const v = ex.verifications[0];
  const evidence = ex.evidence.map((e) => toPublicEvidence(e, { publicView: true }));
  return {
    kind: "execution" as const,
    token,
    title: ex.objective.title,
    category: null,
    depth: "standard" as const,
    result: ex.result ?? "",
    version: 1,
    // TaskSource-compatible list so the shared citation components render [n].
    sources: evidence.map((e) => ({ n: e.n, kind: e.sourceKind, title: e.title, url: e.url, domain: e.domain, snippet: e.snippet, publishedAt: e.publishedAt })),
    completedAt: ex.completedAt?.toISOString() ?? null,
    leadAgent: null,
    team: ex.steps.filter((s) => s.status === "COMPLETED").map((s) => ({ agentName: s.agent, role: s.executive, title: s.title })),
    objective: {
      title: ex.objective.title,
      criteria: ex.objective.criteria.map(toPublicCriterion),
      measurements: ex.measurements.map(toPublicMeasurement),
      outcomeStatus: ex.outcomeStatus,
      outcomeSummary: ex.outcomeSummary,
    },
    verification: v ? { status: v.status, score: v.score, summary: v.summary, warnings: v.warnings, checks: v.checks } : null,
  };
}

export async function loadPublicReport(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  return (await loadTaskReport(token)) ?? (await loadExecutionReport(token));
}

router.get(
  "/reports/:token",
  ah(async (req, res) => {
    const report = await loadPublicReport(req.params.token);
    if (!report) throw new HttpError(404, "This report isn't shared, or the link has been turned off.");
    // Never cached: turning sharing off must take effect immediately.
    res.set("Cache-Control", "no-store");
    res.json({ report });
  })
);

export default router;
