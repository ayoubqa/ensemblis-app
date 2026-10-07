import { Router } from "express";
import { prisma } from "../db";
import { requireAuth, requireRegistered, AuthedRequest } from "../auth/middleware";
import { ah, HttpError } from "../lib/http";
import { toPublicAgent } from "../lib/serializers";

// "My workforce": the agents a user has saved.
const router = Router();
router.use(requireAuth);

router.get(
  "/",
  ah<AuthedRequest>(async (req, res) => {
    const members = await prisma.workforceMember.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: { agent: true },
    });
    res.json({ agents: members.map((m) => toPublicAgent(m.agent)) });
  })
);

router.post(
  "/:agentId",
  requireRegistered("save agents to your workforce"),
  ah<AuthedRequest>(async (req, res) => {
    const agent = await prisma.agent.findFirst({
      where: { OR: [{ id: req.params.agentId }, { slug: req.params.agentId }] },
    });
    if (!agent || (!agent.isLive && agent.ownerId !== req.userId)) throw new HttpError(404, "Agent not found");
    await prisma.workforceMember.upsert({
      where: { userId_agentId: { userId: req.userId!, agentId: agent.id } },
      update: {},
      create: { userId: req.userId!, agentId: agent.id },
    });
    res.json({ ok: true });
  })
);

router.delete(
  "/:agentId",
  ah<AuthedRequest>(async (req, res) => {
    await prisma.workforceMember.deleteMany({ where: { userId: req.userId, agentId: req.params.agentId } });
    res.json({ ok: true });
  })
);

export default router;
