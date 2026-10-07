// Who may see / act on a task (v3). A task is accessible to the person who
// started it and — when it was started inside a team — to every member of
// that team.

import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "./http";

/** The team the user currently belongs to, or null. */
export async function currentTeamId(userId: string): Promise<string | null> {
  const m = await prisma.teamMember.findUnique({ where: { userId }, select: { teamId: true } });
  return m?.teamId ?? null;
}

/**
 * Prisma `where` for tasks visible to `userId`.
 * scope "mine" = started by them; "team" = their team's tasks; undefined = both.
 */
export async function accessibleTasksWhere(userId: string, scope?: "mine" | "team"): Promise<Prisma.TaskWhereInput> {
  const teamId = await currentTeamId(userId);
  if (scope === "mine") return { userId };
  if (scope === "team") return teamId ? { teamId } : { id: "__none__" };
  return teamId ? { OR: [{ userId }, { teamId }] } : { userId };
}

/** Loads a task the user may access (with the given include) or throws 404. */
export async function findAccessibleTask<I extends Prisma.TaskInclude>(
  userId: string,
  taskId: string,
  include: I
): Promise<Prisma.TaskGetPayload<{ include: I }>> {
  const where = await accessibleTasksWhere(userId);
  const task = await prisma.task.findFirst({ where: { AND: [{ id: taskId }, where] }, include });
  if (!task) throw new HttpError(404, "Task not found");
  return task as Prisma.TaskGetPayload<{ include: I }>;
}
