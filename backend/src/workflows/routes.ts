import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: AuthedRequest, res) => {
  const workflows = await prisma.workflow.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ workflows });
});

const createSchema = z.object({
  name: z.string().min(1),
  basedOnText: z.string().min(1),
  frequency: z.enum(["Weekly", "Monthly", "Quarterly"]).default("Monthly"),
});

router.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const workflow = await prisma.workflow.create({
    data: { ...parsed.data, userId: req.userId! },
  });
  res.status(201).json({ workflow });
});

router.delete("/:id", async (req: AuthedRequest, res) => {
  await prisma.workflow.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  res.status(204).send();
});

// NOTE: this scaffold runs a workflow's underlying task on demand only.
// A real "runs weekly/monthly on its own" scheduler needs a cron trigger
// (e.g. a hosted cron job or a queue scheduler) that calls this route —
// see the README's "Next steps" section.

export default router;
