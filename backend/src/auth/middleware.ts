import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db";

export interface AuthedRequest extends Request {
  userId?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function verify(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// Reads the "Authorization: Bearer <token>" header, verifies it, and attaches
// req.userId. Every route that needs a signed-in user sits behind this.
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const userId = verify(token);
  if (!userId) return res.status(401).json({ error: "Invalid or expired token" });
  req.userId = userId;
  next();
}

// For public routes whose response is richer when signed in (e.g. agent
// detail's `inWorkforce`). Never rejects: a missing/invalid token just means
// "anonymous".
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (token) {
    const userId = verify(token);
    if (userId) req.userId = userId;
  }
  next();
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
