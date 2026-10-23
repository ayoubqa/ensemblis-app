// The public API contract (engine/serialize.ts) over plain fake rows: no database.
import { describe, expect, it } from "vitest";
import type { ClaimCheck, Evidence, Execution, ExecutionStep, Objective, OutcomeMeasurement, Verification } from "@prisma/client";
import {
  confirmedOutcomeOf,
  criteriaFromAssessment,
  scrubError,
  summarizeUsage,
  toExecutionSummary,
  toPublicExecution,
  toPublicObjective,
  toPublicPlan,
  toPublicResearch,
  toPublicStep,
  toPublicWarnings,
  type FullExecution,
  type UsageLite,
} from "../../src/engine/serialize";

const T0 = new Date("2026-10-14T10:00:00.000Z");
const T1 = new Date("2026-10-14T10:05:00.000Z");

function execution(over: Partial<Execution> = {}): Execution {
  return {
    id: "ex1",
    objectiveId: "ob1",
    orgId: "org1",
    attempt: 1,
    status: "COMPLETED",
    triggeredById: "u1",
    plan: null,
    planSource: "planner",
    plannerVersion: "chief-of-staff-planner/1.0.0",
    estimatedCostCents: 900,
    costCents: 900,
    refundedCents: 0,
    walletUserId: "u1",
    chargedAt: T0,
    result: "# Brief",
    summary: "Done",
    verificationStatus: "PASS",
    verificationScore: 88,
    revisionCount: 0,
    outcomeStatus: "ACHIEVED",
    outcomeSummary: "All criteria met",
    outcomeConfirmedById: null,
    outcomeConfirmedAt: null,
    estimatedManualHours: 6,
    errorMessage: null,
    shareToken: null,
    sharedAt: null,
    startedAt: T0,
    completedAt: T1,
    lastProgressAt: T1,
    createdAt: T0,
    updatedAt: T1,
    confirmedOutcomeStatus: null,
    ...over,
  };
}

function step(over: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "st1",
    executionId: "ex1",
    key: "s1",
    order: 0,
    title: "Frame the objective",
    purpose: "Frame it",
    executive: "chief_of_staff",
    capability: "objective_framing",
    capabilityVersion: "1.0.0",
    agent: "Strategy Lead",
    dependsOn: [],
    inputs: [],
    outputs: [],
    verification: [],
    kind: "work",
    status: "COMPLETED",
    attempts: 1,
    output: "out",
    partialOutput: null,
    summary: "ok",
    error: null,
    provider: "openai",
    model: "openai/gpt-oss-120b",
    tokensIn: 1200,
    tokensOut: 400,
    latencyMs: 2100,
    costCents: 200,
    notBefore: null,
    startedAt: T0,
    completedAt: T1,
    researchStatus: null,
    research: null,
    tokensEstimated: false,
    ...over,
  };
}

function evidence(over: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev1",
    orgId: "org1",
    executionId: "ex1",
    stepId: "st2",
    n: 1,
    kind: "WEB",
    title: "EU data centers 2027",
    url: "https://example.com/dc",
    domain: "example.com",
    excerpt: "Germany is the largest European data center market.",
    content: "SECRET-FULL-CONTENT Germany is the largest European data center market with 2,450 MW.",
    publishedAt: "2026-09-01",
    createdAt: T1,
    provider: "tavily",
    query: "european data center market size",
    retrievedAt: T0,
    retrieval: "search_snippet",
    ...over,
  };
}

function verification(over: Partial<Verification> = {}, claims: ClaimCheck[] = []): Verification & { claims: ClaimCheck[] } {
  return {
    id: "v1",
    executionId: "ex1",
    round: 1,
    status: "PASS",
    score: 88,
    checks: [],
    summary: "Passed",
    warnings: [],
    humanJudgment: [],
    assessment: null,
    method: "deterministic+model",
    version: "verifier/2",
    createdAt: T1,
    modelProvider: "openai",
    modelName: "openai/gpt-oss-120b",
    assessorError: null,
    ...over,
    claims,
  };
}

function claim(over: Partial<ClaimCheck> = {}): ClaimCheck {
  return {
    id: "c1",
    verificationId: "v1",
    order: 0,
    claim: "Germany is the largest market [1].",
    status: "SUPPORTED",
    evidenceNs: [1],
    supportScore: 0.9,
    note: "",
    claimType: "source",
    quote: "Germany is the largest European data center market with 2,450 MW.",
    ...over,
  };
}

function measurement(over: Partial<OutcomeMeasurement> = {}): OutcomeMeasurement {
  return {
    id: "m1",
    executionId: "ex1",
    criterionId: "cr1",
    result: "MET",
    measuredValue: null,
    measurement: "3 markets ranked",
    explanation: "Ranked with sources",
    method: "model-assessed",
    createdAt: T1,
    updatedAt: T1,
    evidenceNs: [1, 2],
    ...over,
  };
}

function full(over: Partial<FullExecution> = {}): FullExecution {
  return {
    ...execution(),
    steps: [step()],
    evidence: [],
    verifications: [],
    measurements: [],
    approvals: [],
    exceptions: [],
    memories: [],
    events: [],
    usageEvents: [],
    objective: { kind: null },
    ...over,
  };
}

const llm = (over: Partial<UsageLite> = {}): UsageLite => ({ kind: "llm", provider: "openai", model: "m-main", purpose: "step", tokensIn: 100, tokensOut: 50, latencyMs: 1000, ok: true, estimated: false, ...over });

describe("usedMockAI", () => {
  it("comes from what the execution's steps actually ran on", () => {
    expect(toExecutionSummary({ ...execution(), steps: [step(), step({ id: "st2", provider: "mock", model: "mock" })] }).usedMockAI).toBe(true);
    expect(toExecutionSummary({ ...execution(), steps: [step()] }).usedMockAI).toBe(false);
  });

  it("also counts metered calls and the verifier run on the mock", () => {
    expect(toPublicExecution(full({ steps: [step()], usageEvents: [llm({ provider: "mock", purpose: "plan" })] })).usedMockAI).toBe(true);
    expect(toPublicExecution(full({ steps: [step()], verifications: [verification({ modelProvider: "mock" })] })).usedMockAI).toBe(true);
    expect(toPublicExecution(full({ steps: [step()], usageEvents: [llm()] })).usedMockAI).toBe(false);
  });
});

describe("endpoints", () => {
  const stamped = { title: "Plan", steps: [], runtime: { modelEndpoint: "stub", searchEndpoint: "public" } };
  const searched = (endpoint?: string) => ({ status: "ok", attempts: [{ query: "q", provider: "tavily", ok: true, resultCount: 3, ms: 9, ...(endpoint ? { endpoint } : {}) }] });

  it("combine the plan's runtime stamp with the search attempts' markers, in lists and the full execution", () => {
    const steps = [step(), step({ id: "st2", researchStatus: "ok", research: searched("custom") })];
    expect(toExecutionSummary({ ...execution({ plan: stamped }), steps }).endpoints).toEqual({ model: "stub", search: "custom" });
    expect(toPublicExecution(full({ plan: stamped, steps })).endpoints).toEqual({ model: "stub", search: "custom" });
    expect(toExecutionSummary({ ...execution({ plan: stamped }), steps: [step({ researchStatus: "ok", research: searched("public") })] }).endpoints.search).toBe("public");
    // Stamped, but no step searched: search not used.
    expect(toExecutionSummary({ ...execution({ plan: stamped }), steps: [step()] }).endpoints).toEqual({ model: "stub", search: null });
  });

  it("are null for an execution from before they were recorded, whatever the server runs on now", () => {
    const legacy = { ...execution({ plan: { title: "Plan", steps: [] } }), steps: [step({ researchStatus: "ok", research: searched() })] };
    expect(toExecutionSummary(legacy).endpoints).toEqual({ model: null, search: null });
    expect(toExecutionSummary({ ...execution(), steps: [step()] }).endpoints).toEqual({ model: null, search: null });
  });
});

describe("execution summary", () => {
  it("carries resultState/resultReasons and keeps the AI-measured outcome apart from a person's confirmation", () => {
    const s = toExecutionSummary(
      { ...execution({ verificationStatus: "PASS", outcomeStatus: "PARTIALLY_ACHIEVED", confirmedOutcomeStatus: "ACHIEVED" }), steps: [step(), step({ id: "st2", title: "Competitor scan", status: "SKIPPED" })] },
      { objectiveKind: null }
    );
    expect(s.resultState).toBe("partial");
    expect(s.resultReasons.some((r) => /Competitor scan/.test(r))).toBe(true);
    expect(s.outcomeStatus).toBe("PARTIALLY_ACHIEVED");
    expect(s.confirmedOutcomeStatus).toBe("ACHIEVED");
  });

  it("an outcome confirmed before confirmedOutcomeStatus existed (outcomeConfirmedAt only) still counts as confirmed", () => {
    // Back then a confirmation overwrote outcomeStatus: that value is the confirmed one.
    const legacy = execution({ outcomeStatus: "ACHIEVED", confirmedOutcomeStatus: null, outcomeConfirmedAt: T1, outcomeConfirmedById: "u1" });
    expect(confirmedOutcomeOf(legacy)).toBe("ACHIEVED");
    expect(toExecutionSummary(legacy).confirmedOutcomeStatus).toBe("ACHIEVED");
    expect(toPublicExecution(full({ ...legacy })).confirmedOutcomeStatus).toBe("ACHIEVED");
    // Not confirmed: AI-assessed only. Confirmed after the change: the person's answer wins.
    expect(toExecutionSummary(execution({ outcomeStatus: "ACHIEVED" })).confirmedOutcomeStatus).toBeNull();
    expect(confirmedOutcomeOf(execution({ outcomeStatus: "ACHIEVED", confirmedOutcomeStatus: "NOT_ACHIEVED", outcomeConfirmedAt: T1 }))).toBe("NOT_ACHIEVED");
  });

  it("uses the objective kind from the objective", () => {
    const o: Objective = {
      id: "ob1",
      orgId: "org1",
      createdById: "u1",
      title: "Brief",
      statement: "Research the EU AI Act",
      contextNotes: "",
      deadline: null,
      budgetCents: 2000,
      autonomy: "REVIEW_PLAN",
      status: "COMPLETED",
      outcomeStatus: "ACHIEVED",
      workflowId: null,
      createdAt: T0,
      updatedAt: T1,
      completedAt: T1,
      kind: "research_brief",
      constraints: "EU only; no vendor marketing pages",
    };
    // A brief whose steps never searched the web is partial, even when verification passed.
    const pub = toPublicObjective({ ...o, executions: [{ ...execution(), steps: [step()] }] });
    expect(pub.kind).toBe("research_brief");
    expect(pub.constraints).toBe("EU only; no vendor marketing pages");
    expect(pub.latestExecution?.resultState).toBe("partial");
    expect(toPublicObjective({ ...o, kind: "something_else", constraints: null }).kind).toBeNull();
  });
});

describe("steps", () => {
  it("exposes research status, a bounded research summary and the tokensEstimated flag", () => {
    const s = toPublicStep(
      step({
        id: "st2",
        capability: "market_research",
        researchStatus: "degraded",
        tokensEstimated: true,
        research: {
          status: "degraded",
          providersUsed: ["wikipedia"],
          queries: ["eu ai act timeline"],
          attempts: [
            { query: "eu ai act timeline", provider: "tavily", ok: false, httpStatus: 401, error: "Unauthorized: key tvly-SECRETCANARY123456 rejected", resultCount: 0, ms: 120 },
            { query: "eu ai act timeline", provider: "wikipedia", ok: true, httpStatus: 200, error: null, resultCount: 3, ms: 300 },
          ],
          rawBody: "<html>never passed through</html>",
        },
      }),
      [evidence()]
    );
    expect(s.researchStatus).toBe("degraded");
    expect(s.tokensEstimated).toBe(true);
    expect(s.evidenceNs).toEqual([1]);
    expect(s.research).toEqual({
      providers: ["wikipedia"],
      queries: ["eu ai act timeline"],
      attempts: [
        { query: "eu ai act timeline", provider: "tavily", ok: false, httpStatus: 401, error: "Unauthorized: key tvly-[redacted] rejected", resultCount: 0, ms: 120 },
        { query: "eu ai act timeline", provider: "wikipedia", ok: true, httpStatus: 200, error: null, resultCount: 3, ms: 300 },
      ],
    });
    expect(JSON.stringify(s)).not.toContain("SECRETCANARY");
    expect(JSON.stringify(s)).not.toContain("rawBody");
  });

  it("never reports mock token counts as measured, and leaves unknown as null", () => {
    expect(toPublicStep(step({ provider: "mock", tokensEstimated: null })).tokensEstimated).toBe(true);
    expect(toPublicStep(step({ provider: "openai", tokensEstimated: null })).tokensEstimated).toBeNull();
    expect(toPublicStep(step({ researchStatus: "bogus" })).researchStatus).toBeNull();
    expect(toPublicResearch(null)).toBeNull();
    expect(toPublicResearch(["not", "an", "object"])).toBeNull();
  });
});

describe("summarizeUsage", () => {
  it("groups calls by purpose/provider/model, totals them and flags estimates", () => {
    const u = summarizeUsage([
      llm({ purpose: "plan", tokensIn: 500, tokensOut: 300, latencyMs: 4000 }),
      llm({ purpose: "queries", model: "m-fast", tokensIn: 80, tokensOut: 20, latencyMs: 300 }),
      llm({ purpose: "step", tokensIn: 1000, tokensOut: 600, latencyMs: 5000 }),
      llm({ purpose: "step", tokensIn: 900, tokensOut: 0, latencyMs: 200, ok: false, estimated: true }),
      llm({ purpose: "verify", tokensIn: 700, tokensOut: 200, latencyMs: 2500 }),
      llm({ purpose: null, tokensIn: 10, tokensOut: 10, latencyMs: null, estimated: null }),
      { kind: "search", provider: "tavily", model: null, purpose: null, tokensIn: 0, tokensOut: 0, latencyMs: null, ok: true, estimated: null },
      { kind: "search", provider: "tavily", model: null, purpose: null, tokensIn: 0, tokensOut: 0, latencyMs: null, ok: false, estimated: null },
      { kind: "search", provider: "wikipedia", model: null, purpose: null, tokensIn: 0, tokensOut: 0, latencyMs: null, ok: true, estimated: null },
    ]);
    expect(u.calls).toBe(6);
    expect(u.failedCalls).toBe(1);
    expect(u.tokensIn).toBe(500 + 80 + 1000 + 900 + 700 + 10);
    expect(u.tokensOut).toBe(300 + 20 + 600 + 0 + 200 + 10);
    expect(u.latencyMs).toBe(4000 + 300 + 5000 + 200 + 2500);
    expect(u.estimated).toBe(true);
    expect(u.byPurpose.map((g) => g.purpose)).toEqual(["plan", "queries", "step", "verify", "other"]);
    const stepGroup = u.byPurpose.find((g) => g.purpose === "step")!;
    expect(stepGroup).toEqual({ purpose: "step", provider: "openai", model: "m-main", calls: 2, failed: 1, tokensIn: 1900, tokensOut: 600, latencyMs: 5200, estimated: true });
    expect(u.byPurpose.find((g) => g.purpose === "plan")!.estimated).toBe(false);
    // A row from before the flag existed is not presented as a measured count.
    expect(u.byPurpose.find((g) => g.purpose === "other")!.estimated).toBe(true);
    expect(u.searches).toEqual([
      { provider: "tavily", calls: 2, failed: 1 },
      { provider: "wikipedia", calls: 1, failed: 0 },
    ]);
  });

  it("is measured only when every call reported usage", () => {
    const u = summarizeUsage([llm({ purpose: "plan" }), llm({ purpose: "step" })]);
    expect(u.estimated).toBe(false);
    expect(summarizeUsage([])).toEqual({ calls: 0, failedCalls: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, estimated: false, byPurpose: [], searches: [] });
  });

  it("is the execution's usage field", () => {
    const pub = toPublicExecution(full({ usageEvents: [llm({ provider: "mock", model: "mock", estimated: true, purpose: "step" })] }));
    expect(pub.usage.calls).toBe(1);
    expect(pub.usage.estimated).toBe(true);
    expect(pub.usage.byPurpose[0]).toMatchObject({ purpose: "step", provider: "mock" });
  });
});

describe("evidence", () => {
  it("exposes provenance metadata and never the content", () => {
    const pub = toPublicExecution(full({ evidence: [evidence(), evidence({ id: "ev2", n: 2, kind: "COMPANY_CONTEXT", url: null, domain: null, provider: null, query: null, retrievedAt: null, retrieval: "provided", content: "SECRET-FULL-CONTENT internal" })] }));
    expect(pub.evidence[0]).toMatchObject({
      n: 1,
      kind: "WEB",
      title: "EU data centers 2027",
      url: "https://example.com/dc",
      domain: "example.com",
      snippet: "Germany is the largest European data center market.",
      publishedAt: "2026-09-01",
      provider: "tavily",
      query: "european data center market size",
      retrievedAt: T0.toISOString(),
      retrieval: "search_snippet",
    });
    expect(pub.evidence[1]).toMatchObject({ n: 2, provider: null, query: null, retrievedAt: null, retrieval: "provided" });
    for (const e of pub.evidence) expect(e).not.toHaveProperty("content");
    expect(JSON.stringify(pub)).not.toContain("SECRET-FULL-CONTENT");
  });
});

describe("verification", () => {
  const assessment = {
    alignmentScore: 80,
    alignmentRationale: "ok",
    criteria: [
      { index: 2, status: "PARTIALLY_MET", measuredValue: 2, measurement: "2 of 3 markets", explanation: "Only two", evidence: [2, 1, 1, 9] },
      { index: 1, status: "MET", measuredValue: null, measurement: "Recommendation given", explanation: "Clear", evidence: [1] },
      { index: 3, status: "weird", measurement: 5, explanation: null },
      { index: 0, status: "MET" },
      "garbage",
    ],
    consistencyIssues: [],
    humanJudgment: [],
  };

  it("exposes per-criterion verdicts with evidence refs, model identity, assessor error, claimType and quote", () => {
    const pub = toPublicExecution(
      full({
        evidence: [evidence(), evidence({ id: "ev2", n: 2, url: "https://example.org/x" })],
        verifications: [verification({ assessment, assessorError: null }, [claim(), claim({ id: "c2", order: 1, claim: "Expand to Poland.", status: "UNCITED", evidenceNs: [], claimType: "recommendation", quote: null })])],
      })
    );
    const v = pub.verification!;
    expect(v.modelProvider).toBe("openai");
    expect(v.modelName).toBe("openai/gpt-oss-120b");
    expect(v.assessorError).toBeNull();
    expect(v.criteria).toEqual([
      { index: 1, status: "MET", measuredValue: null, measurement: "Recommendation given", explanation: "Clear", evidence: [1] },
      // [9] does not exist in this execution and is dropped; duplicates collapse.
      { index: 2, status: "PARTIALLY_MET", measuredValue: 2, measurement: "2 of 3 markets", explanation: "Only two", evidence: [1, 2] },
      { index: 3, status: "UNKNOWN", measuredValue: null, measurement: "", explanation: "", evidence: [] },
    ]);
    expect(v.claims).toEqual([
      { claim: "Germany is the largest market [1].", status: "SUPPORTED", evidenceNs: [1], supportScore: 0.9, note: "", claimType: "source", quote: "Germany is the largest European data center market with 2,450 MW." },
      { claim: "Expand to Poland.", status: "UNCITED", evidenceNs: [], supportScore: 0.9, note: "", claimType: "recommendation", quote: null },
    ]);
  });

  it("returns the latest round as verification and every round as history, oldest first", () => {
    const pub = toPublicExecution(
      full({
        verifications: [
          verification({ id: "v2", round: 2, status: "PASS_WITH_WARNINGS", score: 74, summary: "Better", createdAt: T1 }),
          verification({ id: "v1", round: 1, status: "FAIL", score: 40, summary: "Unsupported claims", method: "deterministic+model", createdAt: T0 }),
        ],
      })
    );
    expect(pub.verification!.round).toBe(2);
    expect(pub.verificationHistory).toEqual([
      { round: 1, status: "FAIL", score: 40, summary: "Unsupported claims", method: "deterministic+model", createdAt: T0.toISOString() },
      { round: 2, status: "PASS_WITH_WARNINGS", score: 74, summary: "Better", method: "deterministic+model", createdAt: T1.toISOString() },
    ]);
  });

  it("shows why an UNVERIFIED round could not run, without secrets", () => {
    const pub = toPublicExecution(
      full({
        verificationStatus: "UNVERIFIED",
        verifications: [verification({ status: "UNVERIFIED", method: "deterministic", modelProvider: "openai", assessorError: "401 Unauthorized (Bearer gsk_SECRETCANARY0000000000)" })],
      })
    );
    expect(pub.resultState).toBe("unverified");
    expect(pub.verification!.status).toBe("UNVERIFIED");
    expect(pub.verification!.assessorError).toMatch(/^401 Unauthorized/);
    expect(JSON.stringify(pub)).not.toContain("SECRETCANARY");
    expect(pub.verification!.criteria).toEqual([]);
  });

  it("reads criteria leniently", () => {
    expect(criteriaFromAssessment(null)).toEqual([]);
    expect(criteriaFromAssessment({ criteria: "nope" })).toEqual([]);
    expect(criteriaFromAssessment({ criteria: [{ index: 1, status: "MET", evidence: [3] }] })).toEqual([{ index: 1, status: "MET", measuredValue: null, measurement: "", explanation: "", evidence: [3] }]);
  });
});

describe("measurements and plan", () => {
  it("measurements carry their evidence numbers", () => {
    const pub = toPublicExecution(full({ measurements: [measurement()] }));
    expect(pub.measurements).toEqual([{ criterionId: "cr1", result: "MET", measuredValue: null, measurement: "3 markets ranked", explanation: "Ranked with sources", method: "model-assessed", evidenceNs: [1, 2] }]);
  });

  it("passes plan.blocked through and ignores malformed values", () => {
    const base = { title: "Plan", objective: "Do it", assumptions: [], missingInformation: [], risks: [], notes: [], source: "planner", version: "1", estimatedCostCents: 900, estimatedManualHours: null, steps: [], successCriteria: [] };
    expect(toPublicPlan({ ...base, blocked: { kind: "quota", message: "The AI provider's quota is exhausted." } })!.blocked).toEqual({ kind: "quota", message: "The AI provider's quota is exhausted." });
    expect(toPublicPlan({ ...base, blocked: { kind: "search_unavailable", message: "Web search is off." } })!.blocked).toEqual({ kind: "search_unavailable", message: "Web search is off." });
    expect(toPublicPlan({ ...base, blocked: { kind: "made_up", message: "x" } })!.blocked).toBeNull();
    expect(toPublicPlan(base)!.blocked).toBeNull();
    expect(toPublicExecution(full({ plan: { ...base, blocked: { kind: "config", message: "The AI provider isn't configured." } } })).plan!.blocked).toEqual({ kind: "config", message: "The AI provider isn't configured." });
  });
});

describe("toPublicWarnings (the public shared report)", () => {
  it("replaces provider and operator detail with public-safe wording, keeps the rest, and drops repeats", () => {
    const warnings = [
      "Research: web research in “Market scan” failed (All 3 search attempts failed — Tavily: Tavily rejected the API key (HTTP 401); skipped for 10 min).",
      "Research: web research in “Pricing” returned no usable sources (skipped: today's search budget (SEARCH_DAILY_BUDGET=50) is used up).",
      "Research: “Competitor scan” was skipped, so its work is missing from the result.",
      "The AI verifier could not run: The AI provider's quota is exhausted (Owner: check the usage limits and credits of the account behind OPENAI_API_KEY.)",
      "Claim support checked by text match only: the AI claim check could not run (HTTP 429 from api.groq.com).",
      "Claim support checked by text match only for 3 more claims (the AI claim check covers the first 12).",
      "Unsupported claim: \"The market doubled in 2024\"",
    ];
    const pub = toPublicWarnings(warnings);
    expect(pub).toEqual([
      "Web research was incomplete for part of this result.",
      "Research: “Competitor scan” was skipped, so its work is missing from the result.",
      "The AI verifier was unavailable for this result.",
      "Claims were checked by text match only.",
      "Claim support checked by text match only for 3 more claims (the AI claim check covers the first 12).",
      "Unsupported claim: \"The market doubled in 2024\"",
    ]);
    expect(pub.join(" ")).not.toMatch(/Tavily|HTTP \d|SEARCH_DAILY_BUDGET|OPENAI_API_KEY|quota|groq/);
    expect(toPublicWarnings([])).toEqual([]);
  });
});

describe("scrubError", () => {
  it("masks key-shaped tokens and clips", () => {
    expect(scrubError("bad key sk-ant-abcdef123456 and sk-proj-ABCDEFGH and Bearer abc.def.ghi.jkl")).toBe("bad key sk-ant-[redacted] and sk-[redacted] and Bearer [redacted]");
    expect(scrubError("https://x.test/?api_key=abcd1234&q=1")).toBe("https://x.test/?api_key=[redacted]&q=1");
    expect(scrubError("x".repeat(500), 100)!.length).toBe(100);
    expect(scrubError(null)).toBeNull();
    expect(scrubError("risk-assessment task-1234567")).toBe("risk-assessment task-1234567");
  });
});
