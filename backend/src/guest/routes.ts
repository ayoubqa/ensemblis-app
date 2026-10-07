// "Try without signing up" (v3): POST /api/guest/start creates a temporary
// guest account with a small trial balance. Limited per network (salted IP
// hash — the raw IP is never stored) and per day across the server.

import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { config } from "../config";
import { issueToken } from "../auth/middleware";
import { assertTurnstile } from "../auth/turnstile";
import { GUEST_EMAIL_DOMAIN } from "../auth/routes";
import { ah, HttpError, parse } from "../lib/http";
import { clientIp, clientIpKey } from "../lib/clientIp";
import { guestStartLimiter } from "../lib/rateLimits";
import { loadPublicUser } from "../lib/serializers";
import { startOfTodayUTC, withLock } from "../lib/usageLimits";

const router = Router();

export function hashIp(ip: string | undefined | null): string {
  return createHash("sha256")
    .update(config.ipHashSalt + "|" + (ip || "unknown"))
    .digest("hex");
}

/** Why a new trial can't start right now (null = allowed). Counts trials started today (claimed ones included). */
export async function guestTrialBlocker(ipHash: string, now = new Date()): Promise<string | null> {
  const since = startOfTodayUTC(now);
  const [fromIp, total] = await Promise.all([
    prisma.user.count({ where: { signupIpHash: ipHash, createdAt: { gte: since } } }),
    prisma.user.count({ where: { signupIpHash: { not: null }, createdAt: { gte: since } } }),
  ]);
  if (fromIp >= config.guest.perIpPerDay) {
    return "You've already started a free trial today from this network. Create a free account to keep going — it only takes a minute.";
  }
  if (total >= config.guest.globalPerDay) {
    return "Today's free trials are all taken. Create a free account to get started right away, or come back tomorrow.";
  }
  return null;
}

/** Creates the guest user (after the limit check, under a lock so parallel requests can't overshoot). */
export async function startGuestTrial(ip: string | undefined): Promise<string> {
  const ipHash = hashIp(ip);
  return withLock("guest-start", async () => {
    const blocker = await guestTrialBlocker(ipHash);
    if (blocker) throw new HttpError(429, blocker);
    // Random, never-revealed password: a guest can't sign in with a password,
    // only with the token returned here (until they claim the account).
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const user = await prisma.user.create({
      data: {
        email: `guest-${randomBytes(12).toString("hex")}@${GUEST_EMAIL_DOMAIN}`,
        passwordHash,
        name: "Guest",
        accountType: "COMPANY",
        credits: config.guest.creditsCents,
        termsAcceptedAt: new Date(),
        isGuest: true,
        signupIpHash: ipHash,
        emailOnTaskDone: false,
      },
      select: { id: true },
    });
    return user.id;
  });
}

const startSchema = z.object({
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms and Privacy Policy to start a free trial" }),
  }),
  turnstileToken: z.string().max(4096).optional(),
});

router.post(
  "/start",
  guestStartLimiter,
  ah(async (req, res) => {
    if (!config.guest.enabled) throw new HttpError(403, "The free trial is turned off on this server. Create a free account instead.");
    // A trial can be claimed into a full account without an invite code, so an
    // invite-only server must not hand out trials (that would bypass the code).
    if (config.signupInviteCode) throw new HttpError(403, "Sign-up is invite-only on this server right now, so the free trial is turned off.");
    const body = parse(startSchema, req.body ?? {});
    await assertTurnstile(body.turnstileToken, clientIp(req));
    // Per-network key (real client IP behind Render's proxies; an IPv6 /64 counts as one network).
    const userId = await startGuestTrial(clientIpKey(req));
    res.status(201).json({ token: await issueToken(userId), user: await loadPublicUser(userId) });
  })
);

export default router;
