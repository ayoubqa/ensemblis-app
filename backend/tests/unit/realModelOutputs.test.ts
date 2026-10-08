// Real models don't answer like the mock. These fixtures are the deviations
// seen from gpt-oss, Claude and small local models: chatter and code fences
// around the JSON, trailing commas, over-long fields, numbers as strings,
// lowercase enums, capability names instead of keys, invented capabilities,
// too many steps, and replies truncated by the token budget.

import { afterEach, describe, expect, it } from "vitest";
import { extractJsonObject, parseStructured, withoutTrailingCommas } from "../../src/ai/json";
import { setLLMHandlerForTests } from "../../src/ai/llmProvider";
import { runStructured } from "../../src/ai/structured";
import { normalizePlan, planObjective, planSchema, resolveCapability, type PlannerInput } from "../../src/engine/planner";
import { assessResult } from "../../src/engine/verification/assessor";
import { z } from "zod";

afterEach(() => setLLMHandlerForTests(null));

const step = (id: string, capability: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Step ${id}`,
  executive: "marketing",
  capability,
  purpose: "Establish what this objective needs from this step.",
  ...extra,
});
const PLAN = {
  title: "European expansion",
  objective: "Recommend three markets",
  successCriteria: [{ description: "Three markets, ranked", kind: "quantitative", targetValue: 3, unit: "markets" }],
  assumptions: [],
  missingInformation: [],
  steps: [step("s1", "objective_framing"), step("s2", "market_research"), step("s3", "cross_functional_synthesis")],
  estimatedManualHours: 12,
  risks: [],
};
const input: PlannerInput = {
  title: "European expansion",
  statement: "Recommend the three best European markets for our liquid-cooling product.",
  contextNotes: "",
  deadline: null,
  budgetCents: 5000,
  criteria: [],
  companyProfile: "Company: Coolstack\nWhat the company does: liquid cooling for data centers.",
  memories: [],
  documentTitles: [],
  questionsSettled: false,
};

describe("JSON extraction from real model replies", () => {
  it("finds the JSON inside code fences, chatter and reasoning text with braces", () => {
    const reply = `Sure! Thinking about it {briefly}...\n\n\`\`\`json\n${JSON.stringify(PLAN, null, 2)}\n\`\`\`\nLet me know if you need anything else.`;
    expect(extractJsonObject(reply)).toEqual(PLAN);
  });

  it("accepts trailing commas but leaves commas inside strings alone", () => {
    expect(withoutTrailingCommas('{"a": [1, 2,], "b": "x, }",}')).toBe('{"a": [1, 2], "b": "x, }"}');
    expect(extractJsonObject('{"title": "T", "steps": [{"id": "s1",},],}')).toEqual({ title: "T", steps: [{ id: "s1" }] });
  });

  it("returns null for a reply truncated mid-object", () => {
    expect(extractJsonObject(JSON.stringify(PLAN).slice(0, 180))).toBeNull();
  });
});

describe("plan schema tolerance", () => {
  it("trims over-long text, coerces numbers sent as strings and keeps the plan", () => {
    const r = parseStructured(
      JSON.stringify({
        ...PLAN,
        title: "T".repeat(300),
        objective: "O".repeat(3000),
        estimatedManualHours: "about 16 hours",
        successCriteria: [{ description: "Three markets", kind: "Quantitative", targetValue: "3", unit: "markets" }],
        steps: PLAN.steps.map((s, i) => ({ ...s, id: i + 1, dependsOn: [i] })),
      }),
      planSchema
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.title).toHaveLength(140);
    expect(r.data.objective).toHaveLength(800);
    expect(r.data.estimatedManualHours).toBe(16);
    expect(r.data.successCriteria[0]).toMatchObject({ kind: "quantitative", targetValue: 3 });
    expect(r.data.steps[0].id).toBe("1");
  });

  it("drops one malformed step instead of discarding the whole plan", () => {
    const r = parseStructured(JSON.stringify({ ...PLAN, steps: [...PLAN.steps, { id: "s4", title: "x" }] }), planSchema);
    expect(r.ok && r.data.steps.length).toBe(3);
  });

  it("still rejects a reply with no usable steps", () => {
    expect(parseStructured(JSON.stringify({ ...PLAN, steps: [{ title: "only junk" }] }), planSchema).ok).toBe(false);
  });
});

describe("capability names written by real models", () => {
  it.each([
    ["Market Research", "market_research"],
    ["market-research", "market_research"],
    ["marketing/competitor_analysis", "competitor_analysis"],
    ["`unit_economics`", "unit_economics"],
    ["Customer / ICP Analysis", "icp_analysis"],
    ["Head of Finance -> Scenario Analysis", "scenario_analysis"],
  ])("reads %j as %s", (raw, key) => {
    expect(resolveCapability(raw)?.key).toBe(key);
  });

  it("never invents a capability", () => {
    expect(resolveCapability("blockchain_strategy")).toBeUndefined();
    expect(resolveCapability("send_email")).toBeUndefined();
  });

  it("normalises a 13-step plan with names and an invented capability into a valid ≤7-step plan, with notes", () => {
    const steps = [
      step("s1", "Objective Planning"),
      step("s2", "blockchain_strategy"),
      ...["Market Research", "Competitor Analysis", "Customer / ICP Analysis", "Positioning Analysis", "Account Research", "Lead Research", "Financial Analysis", "Scenario Analysis", "Unit Economics", "Process Analysis"].map((c, i) => step(`w${i}`, c)),
      step("s13", "Cross-functional Synthesis"),
    ];
    const parsed = parseStructured(JSON.stringify({ ...PLAN, steps }), planSchema);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const plan = normalizePlan(parsed.data, input);
    expect(plan.steps.length).toBeLessThanOrEqual(7);
    expect(plan.steps[0].capability).toBe("objective_framing");
    expect(plan.steps[plan.steps.length - 1].capability).toBe("cross_functional_synthesis");
    expect(plan.notes.join(" ")).toMatch(/unknown capability "blockchain_strategy"/);
    expect(plan.notes.join(" ")).toMatch(/capped at 7 steps/);
  });
});

describe("one repair attempt", () => {
  it("uses the second reply when the first was truncated, and records why", async () => {
    let calls = 0;
    setLLMHandlerForTests(async (_s, user) => {
      calls++;
      if (calls === 1) return JSON.stringify(PLAN).slice(0, 200);
      expect(user).toMatch(/previous_reply_problem/);
      return JSON.stringify(PLAN);
    });
    const plan = await planObjective(input);
    expect(calls).toBe(2);
    expect(plan.source).toBe("planner");
    expect(plan.notes[0]).toMatch(/first reply was unusable/);
  });

  it("falls back to the labelled playbook only after two unusable replies", async () => {
    let calls = 0;
    setLLMHandlerForTests(async () => {
      calls++;
      return "I can't produce JSON right now.";
    });
    const plan = await planObjective(input);
    expect(calls).toBe(2);
    expect(plan.source).toBe("fallback");
    expect(plan.notes.join(" ")).toMatch(/not a valid plan/);
  });

  it("doesn't spend a second call on a provider error", async () => {
    let calls = 0;
    setLLMHandlerForTests(async () => {
      calls++;
      throw new Error("AI rate limit reached");
    });
    const r = await runStructured("s", "u", z.object({ a: z.number() }), { maxTokens: 100 });
    expect(r).toMatchObject({ ok: false, attempts: 1 });
    expect(calls).toBe(1);
  });
});

describe("verifier assessment tolerance", () => {
  const args = {
    executionId: "x",
    objectiveTitle: "European expansion",
    statement: "Recommend three markets.",
    criteria: [
      { description: "Three markets, ranked", targetValue: 3, unit: "markets" },
      { description: "Risks stated", targetValue: null, unit: null },
    ],
    report: "# Result\n\nGermany, the Netherlands and the Nordics.",
    claimResults: [],
  };

  it("accepts lowercase statuses, numbers as strings and long explanations", async () => {
    setLLMHandlerForTests(async () =>
      `Here is my assessment:\n${JSON.stringify({
        objectiveAlignment: { score: "82/100", rationale: "R".repeat(2000) },
        criteria: [
          { index: "1", status: "met", measuredValue: "3", measurement: "3 markets recommended", explanation: "E".repeat(1500) },
          { index: 2, status: "Partially met", measurement: "risks listed for two of three markets" },
        ],
        consistencyIssues: [],
        humanJudgment: ["Confirm the budget assumption"],
      })}`
    );
    const a = await assessResult(args);
    expect(a).not.toBeNull();
    expect(a!.alignmentScore).toBe(82);
    expect(a!.criteria.map((c) => c.status)).toEqual(["MET", "PARTIALLY_MET"]);
    expect(a!.criteria[0].measuredValue).toBe(3);
    expect(a!.alignmentRationale.length).toBeLessThanOrEqual(600);
  });

  it("an invalid status is dropped, never turned into MET", async () => {
    setLLMHandlerForTests(async () => JSON.stringify({ objectiveAlignment: { score: 70 }, criteria: [{ index: 1, status: "probably" }, { index: 2, status: "NOT_MET" }] }));
    const a = await assessResult(args);
    expect(a!.criteria).toEqual([expect.objectContaining({ index: 2, status: "NOT_MET" })]);
  });
});
