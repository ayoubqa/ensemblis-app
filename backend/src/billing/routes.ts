import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { toPublicTransaction, toPublicUser } from "../lib/serializers";

// Demo credits only — no real payments yet. 1 credit = 1 cent (EUR).
const router = Router();
router.use(requireAuth);

const startOfMonthUTC = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** Net spend = charges minus refunds (top-ups excluded), as a positive number. */
async function netSpend(userId: string, since?: Date): Promise<number> {
  const agg = await prisma.transaction.aggregate({
    where: { userId, type: { in: ["TASK_CHARGE", "REFUND"] }, ...(since ? { createdAt: { gte: since } } : {}) },
    _sum: { amountCents: true },
  });
  return Math.max(0, -(agg._sum.amountCents ?? 0));
}

export async function billingSummary(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "User not found");
  const [monthSpendCents, lifetimeSpendCents, transactions] = await Promise.all([
    netSpend(userId, startOfMonthUTC()),
    netSpend(userId),
    prisma.transaction.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return {
    balanceCents: user.credits,
    monthSpendCents,
    lifetimeSpendCents,
    transactions: transactions.map(toPublicTransaction),
  };
}

router.get(
  "/",
  ah<AuthedRequest>(async (req, res) => {
    res.json(await billingSummary(req.userId!));
  })
);

const topupSchema = z.object({
  amountCents: z
    .number({ invalid_type_error: "amountCents must be a number" })
    .int("amountCents must be a whole number of cents")
    .min(100, "Minimum top-up is €1")
    .max(50000, "Maximum top-up is €500 per request"),
});

router.post(
  "/topup",
  ah<AuthedRequest>(async (req, res) => {
    const { amountCents } = parse(topupSchema, req.body);
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: req.userId }, data: { credits: { increment: amountCents } } });
      await tx.transaction.create({
        data: {
          userId: u.id,
          type: "TOP_UP",
          amountCents,
          description: `Demo credit top-up (€${(amountCents / 100).toFixed(2)})`,
        },
      });
      return u;
    });
    res.json({ billing: await billingSummary(user.id), user: toPublicUser(user) });
  })
);

export default router;
