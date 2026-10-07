// Public, unauthenticated read-only pages (v3): GET /api/public/reports/:token
// serves a report its owner chose to share (/r/<token>). Only report content
// is exposed — never the brief, the account, the price or attachments.

import { Router } from "express";
import { prisma } from "../db";
import { ah, HttpError } from "../lib/http";
import { asDepth, toPublicAgent, toSharedSource } from "../lib/serializers";

const router = Router();

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export async function loadPublicReport(token: string) {
  if (!TOKEN_RE.test(token)) return null;
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
  const result = latest?.result ?? task.result ?? "";
  return {
    token,
    title: task.title,
    category: task.category,
    depth: asDepth(task.depth),
    result,
    version: latest?.result ? latest.version : 1,
    // Uploaded files stay private: their sources are listed without the extracted text.
    sources: task.sources.map(toSharedSource),
    completedAt: (latest?.completedAt ?? task.completedAt)?.toISOString() ?? null,
    leadAgent: task.agent ? toPublicAgent(task.agent) : null,
    team: task.steps.map((s) => ({ agentName: s.agentName, role: s.role, title: s.title })),
  };
}

router.get(
  "/reports/:token",
  ah(async (req, res) => {
    const report = await loadPublicReport(req.params.token);
    if (!report) throw new HttpError(404, "This report isn't shared, or the link has been turned off.");
    // Never cached (browsers or shared caches): turning sharing off must take effect immediately.
    res.set("Cache-Control", "no-store");
    res.json({ report });
  })
);

export default router;
