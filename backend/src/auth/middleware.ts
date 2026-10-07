import { createHash } from "crypto";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db";

export interface AuthedRequest extends Request {
  userId?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

/**
 * Short fingerprint of the account's password hash, embedded in every token
 * (claim `pv`). Changing or resetting the password changes the hash, so every
 * token issued before the change stops matching and is rejected — a stolen
 * session can't outlive a password reset. The fingerprint reveals nothing
 * usable about the password (it's a truncated SHA-256 of a bcrypt hash).
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);
}

/** Signs a session token. Always pass the user's current passwordHash. */
export function signToken(userId: string, passwordHash: string): string {
  return jwt.sign({ sub: userId, pv: passwordFingerprint(passwordHash) }, JWT_SECRET, { expiresIn: "30d" });
}

/** Loads the user's current password hash and signs a token for them. */
export async function issueToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  return signToken(userId, user.passwordHash);
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

type Verified = { ok: true; userId: string } | { ok: false; error: string };

/** Verifies signature/expiry, then that the account exists and the password hasn't changed since. */
async function verify(token: string): Promise<Verified> {
  let payload: { sub?: unknown; pv?: unknown };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { sub?: unknown; pv?: unknown };
  } catch {
    return { ok: false, error: "Invalid or expired token" };
  }
  if (typeof payload.sub !== "string" || typeof payload.pv !== "string") {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { passwordHash: true } });
  if (!user) return { ok: false, error: "This account no longer exists. Please sign in again." };
  if (passwordFingerprint(user.passwordHash) !== payload.pv) {
    return { ok: false, error: "Your password was changed, so this session has ended. Please sign in again." };
  }
  return { ok: true, userId: payload.sub };
}

// Reads the "Authorization: Bearer <token>" header, verifies it, and attaches
// req.userId. Every route that needs a signed-in user sits behind this.
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  verify(token)
    .then((v) => {
      if (!v.ok) return res.status(401).json({ error: v.error });
      req.userId = v.userId;
      next();
    })
    .catch(next);
}

// For public routes whose response is richer when signed in (e.g. agent
// detail's `inWorkforce`). Never rejects: a missing/invalid token just means
// "anonymous".
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next();
  verify(token)
    .then((v) => {
      if (v.ok) req.userId = v.userId;
      next();
    })
    .catch(next);
}

// Must run after requireAuth. Blocks guest-trial accounts with a friendly
// "Create a free account to <action>." 403 (v3).
export function requireRegistered(action: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    prisma.user
      .findUnique({ where: { id: req.userId }, select: { isGuest: true } })
      .then((user) => {
        if (!user) return res.status(401).json({ error: "This account no longer exists. Please sign in again." });
        if (user.isGuest) return res.status(403).json({ error: `Create a free account to ${action}.` });
        next();
      })
      .catch(next);
  };
}

// Must run after requireAuth. Restricts a route to DEVELOPER accounts.
export function requireDeveloper(req: AuthedRequest, res: Response, next: NextFunction) {
  prisma.user
    .findUnique({ where: { id: req.userId }, select: { accountType: true } })
    .then((user) => {
      if (!user) return res.status(401).json({ error: "Account no longer exists" });
      if (user.accountType !== "DEVELOPER") {
        return res.status(403).json({ error: "This is only available to developer accounts" });
      }
      next();
    })
    .catch(next);
}
