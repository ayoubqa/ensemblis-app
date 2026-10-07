// Deletes attachments that were uploaded but never used for a task (v3).
// Called periodically by the scheduler. Never throws.

import { prisma } from "../db";

export const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Removes unattached attachments older than 24 hours; returns how many were deleted. */
export async function cleanupOrphanAttachments(now = new Date()): Promise<number> {
  try {
    const { count } = await prisma.taskAttachment.deleteMany({
      where: { taskId: null, createdAt: { lt: new Date(now.getTime() - ORPHAN_MAX_AGE_MS) } },
    });
    if (count) console.log(`[attachments] removed ${count} unused attachment(s) older than 24h`);
    return count;
  } catch (err) {
    console.error("[attachments] orphan cleanup failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
