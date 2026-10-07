// Tenant resolution. Every org-scoped route derives the organization from the
// signed-in user here — never from a client-supplied id.
//
// Membership follows the existing Team model, with the same rule as the
// shared wallet (lib/wallet.ts):
//   - a user who is not in a team works in their own organization;
//   - a team member (or owner) works in the TEAM OWNER's organization.
// The organization row is created lazily (this is the backfill for existing
// users and teams). When a solo user creates a team, their organization — with
// its objectives, context and memory — becomes the team's organization; when
// the team is dissolved it reverts to a personal organization.

import { Prisma, type PrismaClient, type TeamRole } from "@prisma/client";
import type { NextFunction, Response } from "express";
import { prisma } from "../db";
import type { AuthedRequest } from "../auth/middleware";
import { HttpError } from "../lib/http";

type Db = PrismaClient | Prisma.TransactionClient;

export interface OrgContext {
  orgId: string;
  orgName: string;
  userId: string;
  role: TeamRole; // OWNER | MEMBER
  /** Whose User.credits pays for this organization's executions (the org owner). */
  walletUserId: string;
  teamId: string | null;
  isGuest: boolean;
}

export interface OrgRequest extends AuthedRequest {
  org?: OrgContext;
}

function defaultName(owner: { name: string; company: string | null }, teamName?: string | null): string {
  const n = teamName?.trim() || owner.company?.trim() || `${owner.name.trim() || "My"}'s organization`;
  return n.slice(0, 120);
}

export async function resolveOrg(userId: string, db: Db = prisma): Promise<OrgContext> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      company: true,
      isGuest: true,
      teamMembership: { select: { teamId: true, role: true, team: { select: { ownerId: true, name: true } } } },
    },
  });
  if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  const m = user.teamMembership;
  const ownerId = m ? m.team.ownerId : user.id;
  const wantTeamId = m ? m.teamId : null;

  let org = await db.organization.findUnique({ where: { ownerId } });
  if (!org) {
    const owner =
      ownerId === user.id ? user : await db.user.findUnique({ where: { id: ownerId }, select: { name: true, company: true } });
    if (!owner) throw new HttpError(409, "This team's owner account no longer exists.");
    try {
      org = await db.organization.create({
        data: {
          ownerId,
          name: defaultName(owner, m?.team.name),
          teamId: wantTeamId,
          context: { create: { companyName: owner.company?.trim() ?? "" } },
        },
      });
    } catch (err) {
      // Two first requests raced: the other one created it.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        org = await db.organization.findUniqueOrThrow({ where: { ownerId } });
      } else throw err;
    }
  }
  if (org.teamId !== wantTeamId) {
    // Keep the link in step with the team (created after the org, or dissolved).
    org = await db.organization.update({ where: { id: org.id }, data: { teamId: wantTeamId } });
  }
  return {
    orgId: org.id,
    orgName: org.name,
    userId: user.id,
    role: m ? m.role : "OWNER",
    walletUserId: ownerId,
    teamId: wantTeamId,
    isGuest: user.isGuest,
  };
}

/** Express middleware (after requireAuth): attaches req.org. */
export function requireOrg(req: OrgRequest, _res: Response, next: NextFunction) {
  resolveOrg(req.userId!)
    .then((org) => {
      req.org = org;
      next();
    })
    .catch(next);
}

/** Express middleware (after requireOrg): organization owners only. */
export function requireOrgOwner(req: OrgRequest, _res: Response, next: NextFunction) {
  if (req.org?.role !== "OWNER") return next(new HttpError(403, "Only the organization owner can change this."));
  next();
}
