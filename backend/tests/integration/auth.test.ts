import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { consumeEmailVerification, consumePasswordReset, hashResetToken, hashVerifyToken } from "../../src/auth/routes";
import { api, createUser } from "../helpers";

describe("authentication & authorization", () => {
  it("protected endpoints answer 401 without a valid token", async () => {
    for (const path of ["/api/objectives", "/api/dashboard", "/api/approvals", "/api/exceptions", "/api/context", "/api/memory", "/api/ai-team", "/api/billing", "/api/tasks"]) {
      await api().get(path).expect(401);
      await api().get(path).set({ Authorization: "Bearer not-a-token" }).expect(401);
    }
  });

  it("a token stops working after the password changes", async () => {
    const { auth } = await createUser();
    await api().post("/api/auth/password").set(auth).send({ currentPassword: "password123", newPassword: "newpassword456" }).expect(200);
    await api().get("/api/auth/me").set(auth).expect(401);
  });

  it("an ADMIN_EMAILS address is not admin until it is verified", async () => {
    const { auth, user } = await createUser({ email: "owner@example.com" });
    expect((await api().get("/api/auth/me").set(auth).expect(200)).body.user.isAdmin).toBe(false);
    const r = await api().get("/api/admin/overview").set(auth).expect(403);
    expect(r.body.error).toMatch(/Verify your email/);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    expect((await api().get("/api/auth/me").set(auth).expect(200)).body.user.isAdmin).toBe(true);
    const ok = await api().get("/api/admin/overview").set(auth).expect(200);
    expect(ok.body.executions).toBeDefined();
    expect(ok.body.queue).toBeDefined();
    const other = await createUser({ verified: true });
    await api().get("/api/admin/overview").set(other.auth).expect(403);
  });

  it("email verification tokens are single-use", async () => {
    const { user, auth } = await createUser();
    await prisma.emailVerification.create({ data: { userId: user.id, tokenHash: hashVerifyToken("tok-1234567890"), expiresAt: new Date(Date.now() + 3600_000) } });
    await consumeEmailVerification("tok-1234567890", user.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    await expect(consumeEmailVerification("tok-1234567890", user.id)).rejects.toThrow(/invalid or has expired/);
    const r = await api().post("/api/auth/verify-email").set(auth).send({ token: "tok-1234567890" }).expect(400);
    expect(r.body.error).toMatch(/invalid/);
  });

  it("a verification link only works in the session of the account it was sent to", async () => {
    // Someone registers the operator's address first; the operator opens the emailed link.
    const squatter = await createUser({ email: "owner@example.com" });
    const operator = await createUser({ email: "someone-else@example.com" });
    await prisma.emailVerification.create({ data: { userId: squatter.user.id, tokenHash: hashVerifyToken("tok-squatter-123"), expiresAt: new Date(Date.now() + 3600_000) } });
    await api().post("/api/auth/verify-email").send({ token: "tok-squatter-123" }).expect(401);
    const r = await api().post("/api/auth/verify-email").set(operator.auth).send({ token: "tok-squatter-123" }).expect(403);
    expect(r.body.error).toMatch(/different account/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: squatter.user.id } })).emailVerifiedAt).toBeNull();
    // The rightful session can still use it (the failed attempts didn't consume it).
    const ok = await api().post("/api/auth/verify-email").set(squatter.auth).send({ token: "tok-squatter-123" }).expect(200);
    expect(ok.body.user.id).toBe(squatter.user.id);
  });

  it("completing a password reset also verifies the address", async () => {
    const { user } = await createUser();
    await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hashResetToken("reset-abcdefghijk"), expiresAt: new Date(Date.now() + 3600_000) } });
    await consumePasswordReset("reset-abcdefghijk", "brand-new-password");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
  });

  it("signup creates an organization whose company context starts from the company name", async () => {
    const r = await api()
      .post("/api/auth/signup")
      .send({ email: "founder@coolstack.example", password: "password123", name: "Ada Founder", company: "Coolstack", acceptedTerms: true })
      .expect(201);
    const auth = { Authorization: `Bearer ${r.body.token}` };
    const org = (await api().get("/api/org").set(auth).expect(200)).body.organization;
    expect(org).toMatchObject({ name: "Coolstack", role: "OWNER", defaultAutonomy: "REVIEW_PLAN" });
    expect((await api().get("/api/context").set(auth).expect(200)).body.context.companyName).toBe("Coolstack");
  });

  it("guests can run one objective, then must create an account", async () => {
    const { auth, user } = await createUser({ isGuest: true, credits: 5000 });
    await prisma.transaction.create({ data: { userId: user.id, actorUserId: user.id, type: "TASK_CHARGE", amountCents: -100, description: "earlier run" } });
    const r = await api().post("/api/objectives").set(auth).send({ statement: "Recommend three markets for our product in Europe." }).expect(403);
    expect(r.body.error).toMatch(/Create a free account/);
  });
});
