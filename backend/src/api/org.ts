// /api/org — the caller's organization and its execution policy settings.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { ah, parse } from "../lib/http";
import { requireOrg, requireOrgOwner, type OrgRequest } from "../org/organization";

const router = Router();
router.use(requireAuth, requireOrg);

async function payload(req: OrgRequest) {
  const o = await prisma.organization.findUniqueOrThrow({ where: { id: req.org!.orgId } });
  return {
    organization: {
      id: o.id,
      name: o.name,
      role: req.org!.role,
      teamId: o.teamId,
      defaultAutonomy: o.defaultAutonomy,
      approvalThresholdCents: o.approvalThresholdCents,
      createdAt: o.createdAt.toISOString(),
    },
  };
}

router.get("/", ah<OrgRequest>(async (req, res) => res.json(await payload(req))));

router.patch(
  "/",
  requireOrgOwner,
  ah<OrgRequest>(async (req, res) => {
    const body = parse(
      z
        .object({
          name: z.string().trim().min(2).max(120),
          defaultAutonomy: z.enum(["REVIEW_PLAN", "AUTO_WITHIN_BUDGET"]),
          approvalThresholdCents: z.number().int().min(0).max(50_000),
        })
        .partial()
        .strict(),
      req.body ?? {}
    );
    await prisma.organization.update({ where: { id: req.org!.orgId }, data: body });
    res.json(await payload(req));
  })
);

export default router;
