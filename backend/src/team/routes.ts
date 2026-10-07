// Teams (v3): one shared wallet (the owner's balance), shared task history,
// invite links. Mounted at /api/team.

import { randomBytes } from "crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRegistered, AuthedRequest } from "../auth/middleware";
import { ah, HttpError, parse } from "../lib/http";
import { teamJoinLimiter } from "../lib/rateLimits";
import { loadPublicUser } from "../lib/serializers";

const router = Router();

const INVITE_TTL_DAYS = 7;
const INVITE_MAX_USES = 10;
const MAX_ACTIVE_INVITES = 20;

const startOfMonthUTC = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

const activeInviteWhere = (teamId: string, now = new Date()): Prisma.TeamInviteWhereInput => ({
  teamId,
  revokedAt: null,
  expiresAt: { gt: now },
});

type InviteRow = { id: string; token: string; maxUses: number; uses: number; expiresAt: Date; createdAt: Date; revokedAt: Date | null };

function toInviteInfo(i: InviteRow) {
  return {
    id: i.id,
    token: i.token,
    maxUses: i.maxUses,
    uses: i.uses,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

/** Why an invite can't be used (null = valid). */
export function inviteInvalidReason(i: Pick<InviteRow, "revokedAt" | "expiresAt" | "uses" | "maxUses">, now = new Date()): "revoked" | "expired" | "used up" | null {
  if (i.revokedAt) return "revoked";
  if (i.expiresAt.getTime() <= now.getTime()) return "expired";
  if (i.uses >= i.maxUses) return "used up";
  return null;
}

/** The full TeamDetail for `viewerId` (frontend/lib/api.ts). */
export async function loadTeamDetail(teamId: string, viewerId: string) {
  const now = new Date();
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      owner: { select: { id: true, name: true, credits: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      invites: { where: { revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!team) throw new HttpError(404, "Team not found");
  const me = team.members.find((m) => m.userId === viewerId);
  if (!me) throw new HttpError(404, "You're not in this team");
  const isOwner = me.role === "OWNER";

  // Objectives each member defined this month in the team's organization.
  const counts = await prisma.objective.groupBy({
    by: ["createdById"],
    where: { organization: { teamId: team.id }, createdAt: { gte: startOfMonthUTC(now) } },
    _count: { _all: true },
  });
  const perUser = new Map(counts.map((c) => [c.createdById ?? "", c._count._all]));

  const members = [...team.members]
    .sort((a, b) => (a.role === b.role ? a.joinedAt.getTime() - b.joinedAt.getTime() : a.role === "OWNER" ? -1 : 1))
    .map((m) => ({
      userId: m.userId,
      name: m.user.name,
      // Emails are only shown to the owner (and to each member for themselves).
      email: isOwner || m.userId === viewerId ? m.user.email : "",
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      objectivesThisMonth: perUser.get(m.userId) ?? 0,
    }));

  return {
    id: team.id,
    name: team.name,
    role: me.role,
    owner: { id: team.owner.id, name: team.owner.name },
    members,
    invites: isOwner ? team.invites.filter((i) => i.uses < i.maxUses).map(toInviteInfo) : [],
    walletCents: team.owner.credits,
    createdAt: team.createdAt.toISOString(),
  };
}

async function membershipOf(userId: string) {
  return prisma.teamMember.findUnique({ where: { userId } });
}

async function requireOwner(userId: string) {
  const m = await membershipOf(userId);
  if (!m) throw new HttpError(404, "You're not in a team");
  if (m.role !== "OWNER") throw new HttpError(403, "Only the team owner can do that");
  return m;
}

const nameSchema = z.object({ name: z.string().trim().min(2, "Team name must be at least 2 characters").max(80) });

// ---------------------------------------------------------------- public: invite preview

router.get(
  "/invites/:token",
  ah(async (req, res) => {
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) throw new HttpError(404, "This invite link doesn't exist");
    const invite = await prisma.teamInvite.findUnique({
      where: { token },
      include: { team: { select: { name: true, owner: { select: { name: true } }, _count: { select: { members: true } } } } },
    });
    if (!invite) throw new HttpError(404, "This invite link doesn't exist");
    const reason = inviteInvalidReason(invite);
    res.json({
      invite: {
        teamName: invite.team.name,
        ownerName: invite.team.owner.name,
        memberCount: invite.team._count.members,
        valid: reason === null,
        reason,
      },
    });
  })
);

// ---------------------------------------------------------------- signed in

router.get(
  "/",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const m = await membershipOf(req.userId!);
    res.json({ team: m ? await loadTeamDetail(m.teamId, req.userId!) : null });
  })
);

router.post(
  "/",
  requireAuth,
  requireRegistered("create a team"),
  ah<AuthedRequest>(async (req, res) => {
    const { name } = parse(nameSchema, req.body);
    const userId = req.userId!;
    if (await membershipOf(userId)) throw new HttpError(409, "You're already in a team. Leave it first to create your own.");
    let teamId: string;
    try {
      teamId = await prisma.$transaction(async (tx) => {
        const team = await tx.team.create({ data: { name, ownerId: userId } });
        await tx.teamMember.create({ data: { teamId: team.id, userId, role: "OWNER" } });
        return team.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "You're already in a team. Leave it first to create your own.");
      throw err;
    }
    res.status(201).json({ team: await loadTeamDetail(teamId, userId), user: await loadPublicUser(userId) });
  })
);

router.patch(
  "/",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const { name } = parse(nameSchema, req.body);
    const m = await requireOwner(req.userId!);
    await prisma.team.update({ where: { id: m.teamId }, data: { name } });
    res.json({ team: await loadTeamDetail(m.teamId, req.userId!) });
  })
);

// Dissolve: members are detached (back on their own balances); team tasks
// stay with the people who started them.
router.delete(
  "/",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const m = await requireOwner(req.userId!);
    await prisma.team.delete({ where: { id: m.teamId } }); // members + invites cascade, Task.teamId -> null
    res.json({ user: await loadPublicUser(req.userId!) });
  })
);

router.get(
  "/invites",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const m = await requireOwner(req.userId!);
    const invites = await prisma.teamInvite.findMany({ where: activeInviteWhere(m.teamId), orderBy: { createdAt: "desc" } });
    res.json({ invites: invites.filter((i) => i.uses < i.maxUses).map(toInviteInfo) });
  })
);

router.post(
  "/invites",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const m = await requireOwner(req.userId!);
    const active = await prisma.teamInvite.count({ where: activeInviteWhere(m.teamId) });
    if (active >= MAX_ACTIVE_INVITES) {
      throw new HttpError(409, `You have ${MAX_ACTIVE_INVITES} active invite links. Revoke one before creating another.`);
    }
    const invite = await prisma.teamInvite.create({
      data: {
        teamId: m.teamId,
        token: randomBytes(18).toString("base64url"),
        createdById: req.userId!,
        maxUses: INVITE_MAX_USES,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600_000),
      },
    });
    res.status(201).json({ invite: toInviteInfo(invite) });
  })
);

router.delete(
  "/invites/:inviteId",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const m = await requireOwner(req.userId!);
    const updated = await prisma.teamInvite.updateMany({
      where: { id: req.params.inviteId, teamId: m.teamId },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) throw new HttpError(404, "Invite not found");
    res.json({ ok: true });
  })
);

const joinSchema = z.object({ token: z.string().trim().min(1, "Invite token is required").max(128) });

router.post(
  "/join",
  requireAuth,
  teamJoinLimiter,
  requireRegistered("join a team"),
  ah<AuthedRequest>(async (req, res) => {
    const { token } = parse(joinSchema, req.body);
    const userId = req.userId!;
    if (await membershipOf(userId)) throw new HttpError(409, "You're already in a team. Leave it first to join another.");
    const invite = await prisma.teamInvite.findUnique({ where: { token } });
    if (!invite) throw new HttpError(404, "This invite link doesn't exist");
    const reason = inviteInvalidReason(invite);
    if (reason) {
      const why = reason === "revoked" ? "was revoked" : reason === "expired" ? "has expired" : "has been used the maximum number of times";
      throw new HttpError(409, `This invite link ${why}. Ask the team owner for a new one.`);
    }

    try {
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        // Atomic: only counts a use while the invite is still valid.
        const used = await tx.teamInvite.updateMany({
          where: { id: invite.id, revokedAt: null, expiresAt: { gt: now }, uses: { lt: invite.maxUses } },
          data: { uses: { increment: 1 } },
        });
        if (used.count === 0) throw new HttpError(409, "This invite link is no longer valid. Ask the team owner for a new one.");
        await tx.teamMember.create({ data: { teamId: invite.teamId, userId, role: "MEMBER" } });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "You're already in a team. Leave it first to join another.");
      throw err;
    }
    res.json({ team: await loadTeamDetail(invite.teamId, userId), user: await loadPublicUser(userId) });
  })
);

router.delete(
  "/members/:userId",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const m = await requireOwner(req.userId!);
    if (req.params.userId === req.userId) {
      throw new HttpError(400, "You can't remove yourself. To close the team, dissolve it instead.");
    }
    const removed = await prisma.teamMember.deleteMany({
      where: { userId: req.params.userId, teamId: m.teamId, role: "MEMBER" },
    });
    if (removed.count === 0) throw new HttpError(404, "That person isn't a member of your team");
    res.json({ team: await loadTeamDetail(m.teamId, req.userId!) });
  })
);

router.post(
  "/leave",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const m = await membershipOf(req.userId!);
    if (!m) throw new HttpError(404, "You're not in a team");
    if (m.role === "OWNER") throw new HttpError(409, "Owners can't leave their own team. Dissolve the team instead.");
    await prisma.teamMember.deleteMany({ where: { userId: req.userId, role: "MEMBER" } });
    res.json({ user: await loadPublicUser(req.userId!) });
  })
);

export default router;
