// /api/executions — one attempt at an objective: state, events, live stream,
// cancel, share, outcome confirmation. Org-scoped.

import { randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { requireOrg, type OrgRequest } from "../org/organization";
import { cancelForOrg } from "../engine/lifecycle";
import { emitNow } from "../engine/events";
import { FULL_EXECUTION_INCLUDE, toPublicEvent, toPublicExecution, type FullExecution } from "../engine/serialize";
import { streamExecution } from "./stream";

const router = Router();
router.use(requireAuth, requireOrg);

async function own(req: OrgRequest, id: string) {
  const ex = await prisma.execution.findFirst({ where: { id, orgId: req.org!.orgId }, select: { id: true, objectiveId: true, status: true, shareToken: true, orgId: true } });
  if (!ex) throw new HttpError(404, "Execution not found");
  return ex;
}

router.get(
  "/:id",
  ah<OrgRequest>(async (req, res) => {
    await own(req, req.params.id);
    const ex = (await prisma.execution.findUniqueOrThrow({ where: { id: req.params.id }, include: FULL_EXECUTION_INCLUDE })) as FullExecution;
    res.set("Cache-Control", "no-store");
    res.json({ execution: toPublicExecution(ex) });
  })
);

router.get(
  "/:id/events",
  ah<OrgRequest>(async (req, res) => {
    await own(req, req.params.id);
    const { after } = parse(z.object({ after: z.coerce.number().int().min(0).default(0) }), req.query);
    const events = await prisma.executionEvent.findMany({ where: { executionId: req.params.id, id: { gt: after } }, orderBy: { id: "asc" }, take: 500 });
    res.json({ events: events.map(toPublicEvent) });
  })
);

router.get(
  "/:id/stream",
  ah<OrgRequest>(async (req, res) => {
    await own(req, req.params.id);
    streamExecution(req, res, { executionId: req.params.id, userId: req.userId! });
  })
);

router.post(
  "/:id/cancel",
  ah<OrgRequest>(async (req, res) => {
    await own(req, req.params.id);
    await cancelForOrg(req.org!, req.params.id);
    const ex = (await prisma.execution.findUniqueOrThrow({ where: { id: req.params.id }, include: FULL_EXECUTION_INCLUDE })) as FullExecution;
    res.json({ execution: toPublicExecution(ex) });
  })
);

router.post(
  "/:id/share",
  ah<OrgRequest>(async (req, res) => {
    const { enabled } = parse(z.object({ enabled: z.boolean({ required_error: "enabled must be true or false" }) }), req.body);
    const ex = await own(req, req.params.id);
    if (enabled) {
      if (ex.status !== "COMPLETED") throw new HttpError(409, "Only completed outcomes can be shared");
      if (!ex.shareToken) {
        await prisma.execution.updateMany({ where: { id: ex.id, shareToken: null }, data: { shareToken: randomBytes(24).toString("base64url"), sharedAt: new Date() } });
      }
    } else {
      // A new link is created next time: old links stay dead.
      await prisma.execution.update({ where: { id: ex.id }, data: { shareToken: null, sharedAt: null } });
    }
    const updated = await prisma.execution.findUniqueOrThrow({ where: { id: ex.id }, select: { shareToken: true } });
    res.json({ shareToken: updated.shareToken });
  })
);

const outcomeSchema = z.object({
  status: z.enum(["ACHIEVED", "PARTIALLY_ACHIEVED", "NOT_ACHIEVED"]),
  note: z.string().trim().max(1000).optional(),
});

// A person confirms (or corrects) the measured outcome.
router.post(
  "/:id/outcome",
  ah<OrgRequest>(async (req, res) => {
    const body = parse(outcomeSchema, req.body);
    const ex = await own(req, req.params.id);
    if (ex.status !== "COMPLETED") throw new HttpError(409, "You can confirm the outcome once the execution has completed.");
    await prisma.$transaction(async (tx) => {
      await tx.execution.update({
        where: { id: ex.id },
        data: { outcomeStatus: body.status, outcomeConfirmedById: req.userId!, outcomeConfirmedAt: new Date() },
      });
      await tx.objective.update({ where: { id: ex.objectiveId }, data: { outcomeStatus: body.status } });
      await tx.valueRecord.create({
        data: {
          orgId: ex.orgId,
          executionId: ex.id,
          objectiveId: ex.objectiveId,
          metric: "objective_achieved",
          value: body.status === "ACHIEVED" ? 1 : body.status === "PARTIALLY_ACHIEVED" ? 0.5 : 0,
          unit: "ratio",
          note: `Confirmed by a person${body.note ? `: ${body.note}` : ""}`.slice(0, 500),
        },
      });
    });
    await emitNow({
      executionId: ex.id,
      orgId: ex.orgId,
      type: "OUTCOME_MEASURED",
      actor: "user",
      message: `Outcome confirmed by a person: ${body.status.replace(/_/g, " ").toLowerCase()}`,
      data: { confirmed: true, status: body.status },
    });
    const full = (await prisma.execution.findUniqueOrThrow({ where: { id: ex.id }, include: FULL_EXECUTION_INCLUDE })) as FullExecution;
    res.json({ execution: toPublicExecution(full) });
  })
);

export default router;
