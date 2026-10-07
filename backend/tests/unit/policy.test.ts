import { describe, expect, it } from "vitest";
import { checkToolAccess, decideApproval, deniedToolsFor, DEFAULT_TOOL_GRANTS } from "../../src/org/policy";
import { CAPABILITIES } from "../../src/org/registry";
import { TOOLS } from "../../src/org/tools";

describe("tool permissions", () => {
  it("grants only read-only tools by default", () => {
    expect(DEFAULT_TOOL_GRANTS).toEqual(["READ_ONLY"]);
    for (const t of Object.values(TOOLS)) expect(t.permission).toBe("READ_ONLY");
    for (const c of CAPABILITIES) expect(deniedToolsFor(c.key)).toEqual([]);
  });

  it("denies unknown tools and anything above READ_ONLY", () => {
    expect(checkToolAccess("send_email").allowed).toBe(false);
    (TOOLS as Record<string, unknown>).crm_write = { key: "crm_write", name: "CRM write", description: "", permission: "WRITE", trust: "internal", version: "1" };
    try {
      const a = checkToolAccess("crm_write");
      expect(a.allowed).toBe(false);
      expect(a.reason).toMatch(/WRITE permission/);
      expect(checkToolAccess("crm_write", ["READ_ONLY", "WRITE"]).allowed).toBe(true);
    } finally {
      delete (TOOLS as Record<string, unknown>).crm_write;
    }
  });
});

describe("approval policy", () => {
  const base = { autonomy: "AUTO_WITHIN_BUDGET" as const, estimatedCostCents: 1150, budgetCents: 2000, approvalThresholdCents: 2000, capabilityKeys: ["objective_framing", "market_research", "cross_functional_synthesis"], criteriaCount: 2 };
  it("lets read-only work within budget and threshold run on its own", () => {
    expect(decideApproval(base)).toMatchObject({ required: false, kind: null, risk: "LOW" });
  });
  it("requires plan review when autonomy says so", () => {
    expect(decideApproval({ ...base, autonomy: "REVIEW_PLAN" })).toMatchObject({ required: true, kind: "PLAN", recommendedDecision: "APPROVE" });
  });
  it("requires budget approval above the budget or the org threshold", () => {
    expect(decideApproval({ ...base, budgetCents: 1000 })).toMatchObject({ required: true, kind: "BUDGET", risk: "MEDIUM" });
    expect(decideApproval({ ...base, approvalThresholdCents: 500 })).toMatchObject({ required: true, kind: "BUDGET" });
  });
});
