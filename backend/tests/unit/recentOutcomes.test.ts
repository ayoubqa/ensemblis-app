// Home's recent outcomes say what the lists say: the result state (a partial result is not a plain
// verified one), whether the output is the mock model's, a person's confirmation (also one recorded
// before confirmedOutcomeStatus existed) and the endpoints stored with the execution.
import { describe, expect, it } from "vitest";
import { toRecentOutcome, type RecentOutcomeRow } from "../../src/api/dashboard";

type Step = RecentOutcomeRow["steps"][number];

const step = (over: Partial<Step> = {}): Step => ({
  status: "COMPLETED",
  title: "Market scan",
  agent: "Analyst",
  executive: "cso",
  order: 0,
  kind: "work",
  provider: "openai",
  researchStatus: null,
  capability: "market_research",
  research: null,
  ...over,
});

const row = (over: Partial<RecentOutcomeRow> = {}): RecentOutcomeRow => ({
  id: "ex1",
  objectiveId: "ob1",
  status: "COMPLETED",
  completedAt: new Date("2026-10-01T10:00:00Z"),
  costCents: 300,
  refundedCents: 100,
  outcomeStatus: "ACHIEVED",
  confirmedOutcomeStatus: null,
  outcomeConfirmedAt: null,
  outcomeSummary: "Three markets ranked.",
  verificationStatus: "PASS",
  verificationScore: 92,
  plan: { title: "Plan", steps: [], runtime: { modelEndpoint: "hosted", searchEndpoint: null } },
  steps: [step(), step({ order: 1, title: "Synthesis" })],
  verifications: [{ modelProvider: "openai" }],
  objective: { title: "EU expansion", kind: null },
  ...over,
});

describe("Home's recent outcomes", () => {
  it("a complete, verified real-model result", () => {
    expect(toRecentOutcome(row())).toEqual({
      executionId: "ex1",
      objectiveId: "ob1",
      objectiveTitle: "EU expansion",
      completedAt: "2026-10-01T10:00:00.000Z",
      costCents: 200,
      outcomeStatus: "ACHIEVED",
      outcomeConfirmed: false,
      outcomeSummary: "Three markets ranked.",
      verificationStatus: "PASS",
      verificationScore: 92,
      resultState: "verified",
      usedMockAI: false,
      endpoints: { model: "hosted", search: null },
    });
  });

  it("a memo whose research failed, or with a skipped step, is a partial result even when verification passed", () => {
    expect(toRecentOutcome(row({ steps: [step({ researchStatus: "failed" }), step({ order: 1 })] })).resultState).toBe("partial");
    expect(toRecentOutcome(row({ steps: [step({ status: "SKIPPED" }), step({ order: 1 })] })).resultState).toBe("partial");
    // A skipped revision is not missing work.
    expect(toRecentOutcome(row({ steps: [step(), step({ order: 1, kind: "revision", status: "SKIPPED" })] })).resultState).toBe("verified");
    expect(toRecentOutcome(row({ verificationStatus: "UNVERIFIED" })).resultState).toBe("unverified");
  });

  it("mock output is labelled from what the steps and the verifier ran on", () => {
    expect(toRecentOutcome(row({ steps: [step({ provider: "mock" })] })).usedMockAI).toBe(true);
    expect(toRecentOutcome(row({ verifications: [{ modelProvider: "mock" }] })).usedMockAI).toBe(true);
    expect(toRecentOutcome(row()).usedMockAI).toBe(false);
  });

  it("a person's confirmation wins, also one recorded before confirmedOutcomeStatus existed", () => {
    expect(toRecentOutcome(row({ confirmedOutcomeStatus: "NOT_ACHIEVED", outcomeConfirmedAt: new Date() }))).toMatchObject({ outcomeStatus: "NOT_ACHIEVED", outcomeConfirmed: true });
    expect(toRecentOutcome(row({ outcomeStatus: "PARTIALLY_ACHIEVED", outcomeConfirmedAt: new Date() }))).toMatchObject({ outcomeStatus: "PARTIALLY_ACHIEVED", outcomeConfirmed: true });
  });

  it("endpoints come from the execution's own record (null for one from before it was stamped)", () => {
    const searched = step({ researchStatus: "ok", research: { status: "ok", attempts: [{ query: "q", provider: "tavily", ok: true, endpoint: "custom" }] } });
    expect(toRecentOutcome(row({ plan: { title: "Plan", steps: [], runtime: { modelEndpoint: "stub", searchEndpoint: "custom" } }, steps: [searched] })).endpoints).toEqual({ model: "stub", search: "custom" });
    expect(toRecentOutcome(row({ plan: { title: "Plan", steps: [] }, steps: [step({ researchStatus: "ok", research: { status: "ok", attempts: [{ query: "q", provider: "tavily", ok: true }] } })] })).endpoints).toEqual({ model: null, search: null });
  });
});
