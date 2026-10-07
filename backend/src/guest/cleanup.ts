// Deletes unclaimed guest-trial accounts older than GUEST_RETENTION_DAYS (v3).
// Run by the scheduler on every tick; cheap when there is nothing to delete
// (one indexed query on User(isGuest, createdAt)).

import { prisma } from "../db";
import { config } from "../config";

const BATCH = 25;

/** Thrown inside the transaction to roll it back when the guest was claimed meanwhile. */
class ClaimedMeanwhile extends Error {}

/** Deletes one guest account and everything that belongs to it. Returns false if it was skipped. */
export async function deleteGuestAccount(userId: string): Promise<boolean> {
  try {
    return await deleteGuestAccountTx(userId);
  } catch (err) {
    if (err instanceof ClaimedMeanwhile) return false;
    throw err;
  }
}

async function deleteGuestAccountTx(userId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Re-check inside the transaction: it may have been claimed meanwhile.
    const user = await tx.user.findFirst({ where: { id: userId, isGuest: true }, select: { id: true } });
    if (!user) return false;
    // Never pull the rug from under a run in progress; try again next tick.
    const running = await tx.task.count({ where: { userId, status: { in: ["RUNNING", "PLANNING"] } } });
    if (running > 0) return false;

    // Children first (relations without ON DELETE CASCADE would block the user delete).
    await tx.transaction.deleteMany({ where: { OR: [{ userId }, { task: { userId } }] } });
    await tx.taskAttachment.deleteMany({ where: { OR: [{ userId }, { task: { userId } }] } });
    // A featured copy of a deleted trial's shared report goes too (curated examples have no task).
    await tx.galleryItem.deleteMany({ where: { isExample: false, task: { userId } } });
    await tx.task.deleteMany({ where: { userId } }); // steps, sources, revisions cascade
    await tx.workflow.deleteMany({ where: { userId } });
    await tx.workforceMember.deleteMany({ where: { userId } });
    await tx.teamSeat.deleteMany({ where: { ownerId: userId } });
    await tx.teamMember.deleteMany({ where: { userId } });
    await tx.team.deleteMany({ where: { ownerId: userId } });
    await tx.passwordReset.deleteMany({ where: { userId } });
    await tx.stripePayment.deleteMany({ where: { userId } });
    await tx.agent.updateMany({ where: { ownerId: userId }, data: { ownerId: null } });
    // Guarded delete: if the guest was claimed (isGuest=false) after the check
    // above, delete nothing and roll everything back — never a real account.
    const gone = await tx.user.deleteMany({ where: { id: userId, isGuest: true } });
    if (gone.count === 0) throw new ClaimedMeanwhile();
    return true;
  });
}

/** Deletes up to BATCH expired guest accounts. Returns how many were deleted. */
export async function cleanupExpiredGuests(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - config.guest.retentionDays * 24 * 3600_000);
  const expired = await prisma.user.findMany({
    where: { isGuest: true, createdAt: { lt: cutoff } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  let deleted = 0;
  for (const g of expired) {
    try {
      if (await deleteGuestAccount(g.id)) deleted++;
    } catch (err) {
      console.error(`[guest-cleanup] could not delete guest ${g.id}:`, err instanceof Error ? err.message : err);
    }
  }
  if (deleted) console.log(`[guest-cleanup] deleted ${deleted} expired guest account(s).`);
  return deleted;
}
