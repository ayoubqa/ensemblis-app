import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { signToken, requireAuth, AuthedRequest } from "./middleware";

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1),
  company: z.string().optional().default(""),
  accountType: z.enum(["COMPANY", "DEVELOPER"]).default("COMPANY"),
  builds: z.string().optional().default(""),
});

// This is the real version of the prototype's role-based sign-up flow
// (company vs. developer persona) — it actually creates an account.
router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password, name, company, accountType, builds } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      company,
      accountType,
      builds,
      role: accountType === "DEVELOPER" ? "Agent developer" : "Founder",
      seats: { create: [{ name, role: "Owner" }] },
    },
  });

  const token = signToken(user.id);
  res.status(201).json({ token, user: toPublicUser(user) });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  const token = signToken(user.id);
  res.json({ token, user: toPublicUser(user) });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: toPublicUser(user) });
});

function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  company: string;
  role: string;
  accountType: string;
  builds: string;
  credits: number;
}) {
  const { id, email, name, company, role, accountType, builds, credits } = user;
  return { id, email, name, company, role, accountType, builds, credits };
}

export default router;
