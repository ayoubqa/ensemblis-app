// /api/approvals — the Approval Center. Org-scoped.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { ah, parse } from "../lib/http";
import { limiter } from "../lib/rateLimits";
import { requireOrg, type OrgRequest } from "../org/organization";
import { decideApproval } from "../engine/lifecycle";
import { toPublicApproval } from "../engine/serialize";

const router = Router();
router.use(requireAuth, requireOrg);
const decideLimiter = limiter(60_000, 30, "Too many decisions in a minute. Please slow down.");

router.get(
  "/",
  ah<OrgRequest>(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(["PENDING", "ALL"]).default("PENDING") }), req.query);
    const rows = await prisma.approval.findMany({
      where: { orgId: req.org!.orgId, ...(status === "PENDING" ? { status: "PENDING" } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { objective: { select: { title: true } } },
    });
    res.json({ approvals: rows.map((a) => toPublicApproval(a, a.objective.title)) });
  })
);

const noteSchema = z.object({ note: z.string().trim().max(1000).optional() }).default({});

for (const [path, decision] of [["approve", "APPROVE"], ["reject", "REJECT"]] as const) {
  router.post(
    `/:id/${path}`,
    decideLimiter,
    ah<OrgRequest>(async (req, res) => {
      const { note } = parse(noteSchema, req.body ?? {});
      const { executionId } = await decideApproval(req.org!, req.params.id, decision, note);
      const a = await prisma.approval.findUniqueOrThrow({ where: { id: req.params.id }, include: { objective: { select: { title: true } } } });
      res.json({ approval: toPublicApproval(a, a.objective.title), executionId });
    })
  );
}

export default router;
