// /api/exceptions — the Exception Center. Org-scoped.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { ah, parse } from "../lib/http";
import { limiter } from "../lib/rateLimits";
import { cleanText } from "../research/text";
import { requireOrg, type OrgRequest } from "../org/organization";
import { resolveException } from "../engine/lifecycle";
import { toPublicException } from "../engine/serialize";

const router = Router();
router.use(requireAuth, requireOrg);
const resolveLimiter = limiter(60_000, 30, "Too many actions in a minute. Please slow down.");

router.get(
  "/",
  ah<OrgRequest>(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(["OPEN", "ALL"]).default("OPEN") }), req.query);
    const rows = await prisma.exception.findMany({
      where: { orgId: req.org!.orgId, ...(status === "OPEN" ? { status: "OPEN" } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { objective: { select: { title: true } } },
    });
    res.json({ exceptions: rows.map((x) => toPublicException(x, x.objective.title)) });
  })
);

const resolveSchema = z.object({
  action: z.enum(["provide_info", "proceed", "retry", "accept", "cancel"]),
  response: z
    .string()
    .max(4000)
    .transform((s) => cleanText(s))
    .optional(),
});

router.post(
  "/:id/resolve",
  resolveLimiter,
  ah<OrgRequest>(async (req, res) => {
    const body = parse(resolveSchema, req.body);
    const { executionId } = await resolveException(req.org!, req.params.id, body.action, body.response);
    const x = await prisma.exception.findUniqueOrThrow({ where: { id: req.params.id }, include: { objective: { select: { title: true } } } });
    res.json({ exception: toPublicException(x, x.objective.title), executionId });
  })
);

export default router;
