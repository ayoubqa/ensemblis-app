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
import { extractClaims } from "../../src/engine/verification/checks";
import { measureCriterion } from "../../src/engine/outcome";
import { isConfigError } from "../../src/engine/executor";
import { suggestForStatement } from "../../src/engine/objectives";
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
        humanJudgment: ["Confirm the budget assumption", "b", "c", "d", "e", "f", "g"],
      })}`
    );
    const a = await assessResult(args);
    expect(a).not.toBeNull();
    expect(a!.alignmentScore).toBe(82);
    expect(a!.criteria.map((c) => c.status)).toEqual(["MET", "PARTIALLY_MET"]);
    expect(a!.criteria[0].measuredValue).toBe(3);
    expect(a!.alignmentRationale.length).toBeLessThanOrEqual(600);
    expect(a!.humanJudgment).toHaveLength(6);
  });

  it("an invalid status is dropped, never turned into MET", async () => {
    setLLMHandlerForTests(async () => JSON.stringify({ objectiveAlignment: { score: 70 }, criteria: [{ index: 1, status: "probably" }, { index: 2, status: "NOT_MET" }] }));
    const a = await assessResult(args);
    expect(a!.criteria).toEqual([expect.objectContaining({ index: 2, status: "NOT_MET" })]);
  });
});

describe("planner questions", () => {
  it("keeps a blocking question even when the model lists more than three", () => {
    const qs = [1, 2, 3].map((i) => ({ question: `Nice-to-know question number ${i}?`, blocking: false }));
    const r = parseStructured(JSON.stringify({ ...PLAN, missingInformation: [...qs, { question: "Which product are we expanding?", blocking: "true" }] }), planSchema);
    expect(r.ok && r.data.missingInformation.map((q) => q.blocking)).toEqual([true, false, false]);
  });
});

describe("outcome measurement direction", () => {
  const base = { id: "c1", unit: "€" };
  it("a cap ('under €50') uses the verifier's judgement, not 'at least N'", () => {
    const c = { ...base, description: "Customer acquisition cost under €50", targetValue: 50 };
    expect(measureCriterion(c, { index: 1, status: "MET", measuredValue: 38, measurement: "CAC €38", explanation: "" }).result).toBe("MET");
    expect(measureCriterion(c, { index: 1, status: "NOT_MET", measuredValue: 120, measurement: "CAC €120", explanation: "" }).result).toBe("NOT_MET");
  });
  it("a count never upgrades the verifier's verdict", () => {
    const c = { ...base, description: "Recommend 3 markets", targetValue: 3, unit: "markets" };
    expect(measureCriterion(c, { index: 1, status: "PARTIALLY_MET", measuredValue: 3, measurement: "3 markets, 2 unsupported", explanation: "" }).result).toBe("PARTIALLY_MET");
    expect(measureCriterion(c, { index: 1, status: "UNKNOWN", measuredValue: 3, measurement: "3 markets", explanation: "" }).result).toBe("MET");
  });
});

describe("uncited figures", () => {
  it("plan dates and durations are not flagged; a real uncited figure is", () => {
    const md = ["## Next steps", "- Within 30 days, run a pilot with two customers.", "- By March 2027, decide on the second market.", "- Plan a 12-month rollout (unverified).", "- The market grew 18% in 2025."].join("\n");
    const claims = extractClaims(md);
    expect(claims.map((c) => c.numbers)).toEqual([["18"]]);
  });
  it("'unverified' counts as a label", () => {
    expect(extractClaims("- Revenue could reach 4.2 million in year one (unverified).")[0].isEstimate).toBe(true);
  });
});

describe("provider limits", () => {
  it("a request too large for the model is a configuration problem, not something to retry", () => {
    expect(isConfigError("This request is too large for the AI model's limits (provider request-size cap).")).toBe(true);
  });
});

describe("criteria suggestions from a real model", () => {
  it("keeps the answer despite case and length slips", async () => {
    setLLMHandlerForTests(async () =>
      JSON.stringify({ title: "Expansion", criteria: [{ description: "Recommend three markets, ranked", kind: "Quantitative" }, { description: "x" }], questions: ["Q".repeat(400)] })
    );
    const s = await suggestForStatement("Recommend the three best European markets for our product.", "");
    expect(s.source).toBe("model");
    expect(s.criteria.map((c) => c.description)).toEqual(["Recommend three markets, ranked"]);
    expect(s.questions[0]).toHaveLength(200);
  });
});
