import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { signToken, requireAuth, AuthedRequest } from "./middleware";
import { ah, HttpError, parse } from "../lib/http";
import { toPublicUser } from "../lib/serializers";
import { config } from "../config";
import { loginLimiter, signupLimiter } from "../lib/rateLimits";

const router = Router();

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().trim().min(1, "Name is required").max(120),
  company: z.string().trim().max(160).optional().default(""),
  accountType: z.enum(["COMPANY", "DEVELOPER"]).default("COMPANY"),
  builds: z.string().trim().max(500).optional().default(""),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms and Privacy Policy to create an account" }),
  }),
  inviteCode: z.string().trim().max(200).optional(),
});

// The real version of the prototype's role-based sign-up flow
// (company vs. developer persona) — it actually creates an account.
router.post(
  "/signup",
  signupLimiter,
  ah(async (req, res) => {
    const { email, password, name, company, accountType, builds, inviteCode } = parse(signupSchema, req.body);

    if (config.signupInviteCode && inviteCode !== config.signupInviteCode) {
      throw new HttpError(403, "Invalid invite code");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new HttpError(409, "An account with that email already exists");

    const passwordHash = await bcrypt.hash(password, 10);
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

    res.status(201).json({ token: signToken(user.id), user: toPublicUser(user) });
  })
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email and password are required"),
  password: z.string().min(1, "Email and password are required"),
});

router.post(
  "/login",
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, "Invalid email or password");
    }
    res.json({ token: signToken(user.id), user: toPublicUser(user) });
  })
);

router.get(
  "/me",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new HttpError(404, "User not found");
    res.json({ user: toPublicUser(user) });
  })
);

const updateMeSchema = z
  .object({
    name: z.string().trim().min(1, "Name can't be empty").max(120),
    company: z.string().trim().max(160).nullable(),
    role: z.string().trim().max(120).nullable(),
    builds: z.string().trim().max(500).nullable(),
  })
  .partial()
  .strict();

router.patch(
  "/me",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(updateMeSchema, req.body ?? {});
    const data: { name?: string; company?: string; role?: string; builds?: string } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.company !== undefined) data.company = body.company ?? "";
    if (body.role !== undefined) data.role = body.role ?? "";
    if (body.builds !== undefined) data.builds = body.builds ?? "";
    const exists = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true } });
    if (!exists) throw new HttpError(404, "User not found");
    const user = await prisma.user.update({ where: { id: req.userId }, data });
    res.json({ user: toPublicUser(user) });
  })
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(200),
});

router.post(
  "/password",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const { currentPassword, newPassword } = parse(passwordSchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new HttpError(404, "User not found");
    // 400 rather than 401 so the client doesn't treat it as an expired session.
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new HttpError(400, "Current password is incorrect");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    res.json({ ok: true });
  })
);

export default router;
