import { describe, expect, it } from "vitest";
import { contextGapQuestion, estimateCost, fallbackPlan, normalizePlan, pickWorkCapabilities, planSchema, type RawPlan } from "../../src/engine/planner";
import { parseStructured } from "../../src/ai/json";
import { VERIFICATION_COST_CENTS } from "../../src/org/registry";

const input = { title: "European expansion", statement: "Recommend the three best European markets for our liquid-cooling product.", criteria: [] };
const raw = (steps: RawPlan["steps"], extra: Partial<RawPlan> = {}): RawPlan => ({
  title: "European expansion",
  objective: "Pick 3 markets",
  successCriteria: [],
  assumptions: [],
  missingInformation: [],
  risks: [],
  steps,
  ...extra,
});
const step = (id: string, capability: string, dependsOn: string[] = [], executive = "marketing") => ({
  id,
  title: `Step ${id}`,
  executive,
  capability,
  purpose: "Do the work for this objective.",
  inputs: [],
  outputs: [],
  verification: [],
  dependsOn,
});

describe("planner normalisation", () => {
  it("drops unknown capabilities and never trusts the model's tool or executive choices", () => {
    const p = normalizePlan(
      raw([step("a", "objective_framing", [], "chief_of_staff"), step("b", "send_emails_to_everyone"), step("c", "financial_analysis", ["a"], "marketing"), step("d", "cross_functional_synthesis", [], "chief_of_staff")]),
      input
    );
    expect(p.steps.map((s) => s.capability)).toEqual(["objective_framing", "financial_analysis", "cross_functional_synthesis"]);
    expect(p.steps[1].executive).toBe("finance"); // corrected to the capability's owner
    expect(p.notes.join(" ")).toMatch(/unknown capability "send_emails_to_everyone"/);
  });

  it("always starts with Objective Planning and ends with exactly one synthesis, all dependencies pointing backwards", () => {
    const p = normalizePlan(
      raw([step("x", "cross_functional_synthesis"), step("y", "market_research", ["z", "y"]), step("z", "competitor_analysis", ["y"]), step("w", "cross_functional_synthesis")]),
      input
    );
    expect(p.steps.map((s) => s.capability)).toEqual(["objective_framing", "market_research", "competitor_analysis", "cross_functional_synthesis"]);
    expect(p.steps.map((s) => s.key)).toEqual(["s1", "s2", "s3", "s4"]);
    for (const s of p.steps) for (const d of s.dependsOn) expect(Number(d.slice(1))).toBeLessThan(Number(s.key.slice(1)));
    expect(p.steps[1].dependsOn).toEqual(["s1"]); // forward/self references removed — no cycles possible
    expect(p.steps[2].dependsOn).toEqual(["s1", "s2"]);
    expect(p.steps[3].dependsOn).toEqual(["s1", "s2", "s3"]);
  });

  it("caps the plan size and adds a work step when the model gave none", () => {
    const many = ["market_research", "competitor_analysis", "icp_analysis", "positioning_analysis", "account_research", "lead_research", "financial_analysis"].map((c, i) => step(`s${i}`, c));
    expect(normalizePlan(raw(many), input).steps).toHaveLength(7);
    const empty = normalizePlan(raw([step("a", "objective_framing")]), input);
    expect(empty.steps).toHaveLength(3);
    expect(empty.steps[1].capability).toBe("market_research");
  });

  it("keeps the user's success criteria (planner proposals only when none were given)", () => {
    const withProposals = raw([step("a", "market_research")], { successCriteria: [{ description: "Rank 3 markets", kind: "quantitative", targetValue: 3, unit: "markets" }] });
    expect(normalizePlan(withProposals, input).successCriteria).toHaveLength(1);
    expect(normalizePlan(withProposals, { ...input, criteria: [{ description: "mine" }] }).successCriteria).toHaveLength(0);
  });

  it("prices the plan deterministically from the registry", () => {
    const p = normalizePlan(raw([step("a", "market_research")]), input);
    expect(p.estimatedCostCents).toBe(estimateCost(p.steps));
    expect(p.estimatedCostCents).toBe(100 + 300 + 300 + VERIFICATION_COST_CENTS);
  });

  it("rejects malformed model JSON (validation, not trust)", () => {
    expect(parseStructured("Sure! Here's the plan: {not json}", planSchema).ok).toBe(false);
    expect(parseStructured(JSON.stringify({ title: "x" }), planSchema).ok).toBe(false);
    const ok = parseStructured("```json\n" + JSON.stringify(raw([step("a", "market_research")])) + "\n```", planSchema);
    expect(ok.ok).toBe(true);
  });

  it("the fallback playbook routes by the objective's words and is labelled as a fallback", () => {
    const p = fallbackPlan({ title: "Fix onboarding", statement: "Map our vendor onboarding process and find bottlenecks", criteria: [] }, "AI planner unavailable");
    expect(p.source).toBe("fallback");
    expect(p.steps.map((s) => s.capability)).toContain("process_analysis");
    expect(p.successCriteria.length).toBeGreaterThan(0);
    expect(pickWorkCapabilities("competitor landscape for our pricing", 2)[0]).toBe("competitor_analysis");
  });

  it("asks what the company does when the objective is about 'our' business and nothing is on file", () => {
    expect(contextGapQuestion({ statement: "Grow our revenue in Spain", contextNotes: "", companyProfile: "" })?.blocking).toBe(true);
    expect(contextGapQuestion({ statement: "Grow our revenue in Spain", contextNotes: "", companyProfile: "What the company does: cooling" })).toBeNull();
    expect(contextGapQuestion({ statement: "Summarise the EU AI Act", contextNotes: "", companyProfile: "" })).toBeNull();
  });
});
