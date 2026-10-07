// Earlier reports (v1–v3 tasks), read-only. Mounted at /api/tasks.
//   GET  /            paginated list (?cursor=<id>&limit=<n>&scope=mine|team)
//   GET  /:id         one report
//   POST /:id/share   public link /r/<token> on/off
// New work is created as objectives (/api/objectives).

import { randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { accessibleTasksWhere, findAccessibleTask } from "../lib/access";
import { TASK_INCLUDE, toPublicTask } from "../lib/serializers";

const router = Router();
router.use(requireAuth);

const listSchema = z.object({
  scope: z.enum(["mine", "team"]).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

router.get(
  "/",
  ah<AuthedRequest>(async (req, res) => {
    const { scope, cursor, limit } = parse(listSchema, req.query);
    const where = await accessibleTasksWhere(req.userId!, scope);
    const rows = await prisma.task.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: TASK_INCLUDE,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    res.json({ tasks: page.map(toPublicTask), nextCursor: rows.length > limit ? page[page.length - 1].id : null });
  })
);

router.get(
  "/:id",
  ah<AuthedRequest>(async (req, res) => {
    const task = await findAccessibleTask(req.userId!, req.params.id, TASK_INCLUDE);
    res.json({ task: toPublicTask(task) });
  })
);

const shareSchema = z.object({ enabled: z.boolean({ required_error: "enabled must be true or false" }) });

// Turning the link off clears the token, so re-enabling creates a NEW link (old links stay dead).
router.post(
  "/:id/share",
  ah<AuthedRequest>(async (req, res) => {
    const { enabled } = parse(shareSchema, req.body);
    const task = await findAccessibleTask(req.userId!, req.params.id, {});
    if (enabled) {
      if (task.status !== "COMPLETED") throw new HttpError(409, "Only completed reports can be shared");
      if (!task.shareToken) {
        await prisma.task.updateMany({
          where: { id: task.id, status: "COMPLETED", shareToken: null },
          data: { shareToken: randomBytes(24).toString("base64url"), sharedAt: new Date() },
        });
      }
    } else {
      // Withdrawing consent also removes any featured gallery copy of the report.
      await prisma.$transaction([
        prisma.task.update({ where: { id: task.id }, data: { shareToken: null, sharedAt: null } }),
        prisma.galleryItem.deleteMany({ where: { taskId: task.id, isExample: false } }),
      ]);
    }
    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: TASK_INCLUDE });
    res.json({ task: toPublicTask(updated) });
  })
);

export default router;
