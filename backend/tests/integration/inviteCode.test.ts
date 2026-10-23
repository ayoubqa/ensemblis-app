// The sign-up invite code: strength flag (never the code itself), constant-time check.
// Made-up codes only.
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { config, inviteCodeStrength, productionConfigWarnings } from "../../src/config";
import { api, createUser } from "../helpers";

const STRONG = "q7Rk2vXz9LmT4bWp8NcY3hJd6FsG1aQe";
const WEAK = "ACME2026";
const signup = (email: string, inviteCode?: string) =>
  api()
    .post("/api/auth/signup")
    .send({ email, password: "password123", name: "Ada Founder", company: "Coolstack", acceptedTerms: true, ...(inviteCode !== undefined ? { inviteCode } : {}) });

describe("sign-up invite code", () => {
  const before = config.signupInviteCode;
  afterEach(() => {
    config.signupInviteCode = before;
  });

  it("classifies how guessable a code is", () => {
    expect(inviteCodeStrength("")).toBe("off");
    for (const c of [WEAK, "acme-2026", "letmein", "aaaaaaaaaaaaaaaaaaaaaaaa", "abcdefghijklmnopqrs"]) expect(inviteCodeStrength(c)).toBe("weak");
    expect(inviteCodeStrength(STRONG)).toBe("strong");
  });

  it("warns at boot about a weak code without ever printing it", () => {
    // Boot warnings are for hosted deployments: simulate Render for this check only.
    process.env.RENDER = "true";
    onTestFinished(() => {
      delete process.env.RENDER;
    });
    config.signupInviteCode = WEAK;
    const warnings = productionConfigWarnings();
    const w = warnings.find((x) => x.startsWith("SIGNUP_INVITE_CODE"));
    expect(w).toMatch(/short or guessable/);
    expect(warnings.join("\n")).not.toContain(WEAK);
    config.signupInviteCode = STRONG;
    expect(productionConfigWarnings().some((x) => x.startsWith("SIGNUP_INVITE_CODE"))).toBe(false);
  });

  it("accepts only the exact code (compared in constant time), and the owner dashboard flags a weak one", async () => {
    config.signupInviteCode = STRONG;
    await signup("a@example.com").expect(403);
    await signup("b@example.com", STRONG.slice(0, -1)).expect(403);
    await signup("c@example.com", `${STRONG}x`).expect(403);
    await signup("d@example.com", STRONG).expect(201);

    const owner = await createUser({ email: "owner@example.com", verified: true });
    expect((await api().get("/api/admin/overview").set(owner.auth).expect(200)).body.security).toEqual({ inviteCode: "strong" });
    config.signupInviteCode = WEAK;
    const body = (await api().get("/api/admin/overview").set(owner.auth).expect(200)).body;
    expect(body.security).toEqual({ inviteCode: "weak" });
    expect(JSON.stringify(body)).not.toContain(WEAK);
  });
});
