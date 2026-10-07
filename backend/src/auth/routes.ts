import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { issueToken, requireAuth, AuthedRequest } from "./middleware";
import { assertTurnstile } from "./turnstile";
import { ah, HttpError, parse } from "../lib/http";
import { clientIp } from "../lib/clientIp";
import { loadPublicUser } from "../lib/serializers";
import { config } from "../config";
import { forgotPasswordLimiter, loginLimiter, resetPasswordLimiter, signupLimiter } from "../lib/rateLimits";
import { sendEmail } from "../email/send";
import { passwordResetEmail } from "../email/templates";

const router = Router();

/** Guest-trial accounts use this reserved domain; it can never be a real address. */
export const GUEST_EMAIL_DOMAIN = "guest.invalid";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254, "Email is too long")
  .refine((e) => !e.endsWith(`@${GUEST_EMAIL_DOMAIN}`), "Enter a real email address");
const password = z.string().min(8, "Password must be at least 8 characters").max(200);
const acceptedTerms = z.literal(true, {
  errorMap: () => ({ message: "You must accept the Terms and Privacy Policy to create an account" }),
});

const accountFields = {
  email,
  password,
  name: z.string().trim().min(1, "Name is required").max(120),
  company: z.string().trim().max(160).optional().default(""),
  accountType: z.enum(["COMPANY", "DEVELOPER"]).default("COMPANY"),
  builds: z.string().trim().max(500).optional().default(""),
  acceptedTerms,
};

const signupSchema = z.object({
  ...accountFields,
  inviteCode: z.string().trim().max(200).optional(),
  turnstileToken: z.string().max(4096).optional(),
});

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

// The real version of the prototype's role-based sign-up flow
// (company vs. developer persona) — it actually creates an account.
router.post(
  "/signup",
  signupLimiter,
  ah(async (req, res) => {
    const { email, password, name, company, accountType, builds, inviteCode, turnstileToken } = parse(signupSchema, req.body);

    if (config.signupInviteCode && inviteCode !== config.signupInviteCode) {
      throw new HttpError(403, "Invalid invite code");
    }
    await assertTurnstile(turnstileToken, clientIp(req));

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new HttpError(409, "An account with that email already exists");

    const passwordHash = await bcrypt.hash(password, 10);
    let userId: string;
    try {
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          company,
          accountType,
          builds,
          credits: config.startingCreditsCents,
          termsAcceptedAt: new Date(),
          role: accountType === "DEVELOPER" ? "Agent developer" : "Founder",
          seats: { create: [{ name, role: "Owner" }] },
        },
      });
      userId = user.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "An account with that email already exists");
      throw err;
    }

    res.status(201).json({ token: await issueToken(userId), user: await loadPublicUser(userId) });
  })
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email and password are required"),
  password: z.string().min(1, "Email and password are required").max(200),
});

router.post(
  "/login",
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user?.isGuest) {
      throw new HttpError(403, "Guest trial accounts can't sign in with a password. Create a free account to keep your work.");
    }
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, "Invalid email or password");
    }
    res.json({ token: await issueToken(user.id), user: await loadPublicUser(user.id) });
  })
);

router.get(
  "/me",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    res.json({ user: await loadPublicUser(req.userId!) });
  })
);

const updateMeSchema = z
  .object({
    name: z.string().trim().min(1, "Name can't be empty").max(120),
    company: z.string().trim().max(160).nullable(),
    role: z.string().trim().max(120).nullable(),
    builds: z.string().trim().max(500).nullable(),
    emailOnTaskDone: z.boolean(),
  })
  .partial()
  .strict();

router.patch(
  "/me",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(updateMeSchema, req.body ?? {});
    const data: Prisma.UserUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.company !== undefined) data.company = body.company ?? "";
    if (body.role !== undefined) data.role = body.role ?? "";
    if (body.builds !== undefined) data.builds = body.builds ?? "";
    if (body.emailOnTaskDone !== undefined) data.emailOnTaskDone = body.emailOnTaskDone;
    const exists = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true } });
    if (!exists) throw new HttpError(401, "This account no longer exists. Please sign in again.");
    await prisma.user.update({ where: { id: req.userId }, data });
    res.json({ user: await loadPublicUser(req.userId!) });
  })
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(200),
  newPassword: password,
});

router.post(
  "/password",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const { currentPassword, newPassword } = parse(passwordSchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
    if (user.isGuest) throw new HttpError(403, "Create a free account to set a password.");
    // 400 rather than 401 so the client doesn't treat it as an expired session.
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new HttpError(400, "Current password is incorrect");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    // The new hash ends every other session; hand this device a fresh token so it stays signed in.
    res.json({ ok: true, token: await issueToken(user.id) });
  })
);

// ---------------------------------------------------------------- v3: claim a guest account

const claimSchema = z.object(accountFields);

// Turns the signed-in GUEST into a real account, keeping its tasks and balance.
router.post(
  "/claim",
  requireAuth,
  signupLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(claimSchema, req.body);
    const guest = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, isGuest: true } });
    if (!guest) throw new HttpError(401, "This trial has expired. Please start again or sign up.");
    if (!guest.isGuest) throw new HttpError(409, "This account is already registered.");
    if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
      throw new HttpError(409, "An account with that email already exists. Sign in instead, or use another email.");
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    try {
      await prisma.$transaction(async (tx) => {
        const flipped = await tx.user.updateMany({
          where: { id: guest.id, isGuest: true },
          data: {
            email: body.email,
            passwordHash,
            name: body.name,
            company: body.company,
            accountType: body.accountType,
            builds: body.builds,
            role: body.accountType === "DEVELOPER" ? "Agent developer" : "Founder",
            termsAcceptedAt: new Date(),
            isGuest: false,
            emailOnTaskDone: true, // guests are created with emails off
          },
        });
        if (flipped.count === 0) throw new HttpError(409, "This account is already registered.");
        if ((await tx.teamSeat.count({ where: { ownerId: guest.id } })) === 0) {
          await tx.teamSeat.create({ data: { ownerId: guest.id, name: body.name, role: "Owner" } });
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "An account with that email already exists. Sign in instead, or use another email.");
      }
      throw err;
    }
    res.json({ token: await issueToken(guest.id), user: await loadPublicUser(guest.id) });
  })
);

// ---------------------------------------------------------------- v3: password reset

const RESET_TTL_MINUTES = 60;
const RESETS_PER_ACCOUNT_PER_HOUR = 3;
export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Creates a single-use reset link and emails it — only for an existing,
 * non-guest account and only when email is configured. Never throws; the
 * caller always answers {ok:true} so it can't reveal which emails exist.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  try {
    if (!config.email.enabled) return;
    const user = await prisma.user.findUnique({
      where: { email: rawEmail.trim().toLowerCase() },
      select: { id: true, email: true, name: true, isGuest: true },
    });
    if (!user || user.isGuest) return;
    // Per-account cap (the route's limit is per IP): stops anyone from flooding
    // a person's inbox — and our email quota — from many networks.
    const recent = await prisma.passwordReset.count({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } },
    });
    if (recent >= RESETS_PER_ACCOUNT_PER_HOUR) return;
    const token = randomBytes(32).toString("base64url");
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      },
    });
    const resetUrl = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const mail = passwordResetEmail({ name: user.name, resetUrl, expiresMinutes: RESET_TTL_MINUTES });
    await sendEmail({ to: user.email, ...mail });
  } catch (err) {
    console.warn("[auth] password reset request failed:", err instanceof Error ? err.message : err);
  }
}

const forgotSchema = z.object({ email: z.string().trim().max(254) });

router.post(
  "/forgot",
  forgotPasswordLimiter,
  ah(async (req, res) => {
    const { email } = parse(forgotSchema, req.body ?? {});
    // Respond first (same timing whether or not the account exists), then work.
    res.json({ ok: true });
    if (email) void requestPasswordReset(email);
  })
);

const resetSchema = z.object({
  token: z.string().trim().min(10, "This reset link is invalid or has expired. Request a new one.").max(200),
  password,
});

/** Consumes a reset token and sets the new password. Returns the user id; throws 400 when invalid. */
export async function consumePasswordReset(token: string, newPassword: string): Promise<string> {
  const invalid = () => new HttpError(400, "This reset link is invalid or has expired. Request a new one.");
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: { select: { id: true, isGuest: true } } },
  });
  const now = new Date();
  if (!reset || reset.usedAt || reset.expiresAt <= now || reset.user.isGuest) throw invalid();
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction(async (tx) => {
    // Single use, even under concurrent requests.
    const used = await tx.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (used.count === 0) throw invalid();
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    // Any other outstanding links for this account stop working too.
    await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: now } });
  });
  return reset.userId;
}

router.post(
  "/reset",
  resetPasswordLimiter,
  ah(async (req, res) => {
    const { token, password } = parse(resetSchema, req.body);
    const userId = await consumePasswordReset(token, password);
    res.json({ token: await issueToken(userId), user: await loadPublicUser(userId) });
  })
);

export default router;
