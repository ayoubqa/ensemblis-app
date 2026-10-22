// A skipped work step, for every objective kind (T1): the verification gate
// can at best pass with warnings, the outcome is never fully ACHIEVED, the
// result state is "partial", and the synthesis is told which work is missing.
// Execution success, verification and outcome stay three separate answers.
import { describe, expect, it } from "vitest";
import type { Evidence, ExecutionStep } from "@prisma/client";
import { stepSystemPrompt, stepUserPrompt, type StepRunInput } from "../../src/engine/executor";
import { cappedOutcome, overallOutcome } from "../../src/engine/outcome";
import { deriveResultState, incompleteWork, type ResultStateStep } from "../../src/engine/resultState";
import { checkClaims, combineVerification, extractClaims, SKIPPED_STEP_ISSUE, type ModelAssessment } from "../../src/engine/verification/checks";
import { getCapability } from "../../src/org/registry";

const evidence = [{ n: 1, title: "EU data centers 2027", content: "Germany is the largest European data center market with 2,450 MW of operational capacity in 2025." }];
const memo = `# Result\n\n## Executive summary\n- Germany is the largest market with 2,450 MW of capacity [1].\n\n## Recommendation\n- Enter Germany first.\n\n## Limitations & uncertainty\n- Some.\n\n## Next steps\n- Pilot.\n`;
const model: ModelAssessment = { alignmentScore: 90, alignmentRationale: "ok", criteria: [{ index: 1, status: "MET", measuredValue: null, measurement: "", explanation: "" }], consistencyIssues: [], humanJudgment: [] };
// The line verification/service.ts researchIssuesFor writes for a skipped work step.
const SKIPPED = "“Market sizing” was skipped, so its work is missing from the result.";

function gate(objectiveKind: string | null, researchIssues: string[]) {
  const claimResults = checkClaims(extractClaims(memo), evidence);
  return combineVerification({ report: memo, evidenceCount: 1, claimResults, criteria: ["Recommend a market"], model, objectiveKind, researchIssues });
}

const steps: ResultStateStep[] = [
  { kind: "work", status: "SKIPPED", title: "Market sizing" },
  { kind: "work", status: "COMPLETED", title: "Synthesis" },
];

describe("a skipped work step in a decision memo", () => {
  it("is a verification warning: never a plain PASS", () => {
    expect(gate(null, []).status).toBe("PASS");
    const v = gate(null, [SKIPPED]);
    expect(v.status).toBe("PASS_WITH_WARNINGS");
    expect(v.warnings).toContain(SKIPPED);
    // Research issues stay brief-only for a memo; only the skipped step counts.
    expect(gate(null, ["web research in “Market sizing” failed, so no external sources were retrieved."]).status).toBe("PASS");
    expect(SKIPPED_STEP_ISSUE.test("web research in “Was skipped” failed.")).toBe(false);
  });

  it("caps the outcome below ACHIEVED and reads as a partial result", () => {
    const v = gate(null, [SKIPPED]);
    const partial = incompleteWork(steps, null).length > 0;
    expect(partial).toBe(true);
    const outcome = cappedOutcome(overallOutcome(["MET"]), { acceptedDespiteFailure: false, objectiveKind: null, verificationStatus: v.status, hasUnsupported: false, partial });
    expect(outcome).toBe("PARTIALLY_ACHIEVED");
    expect(deriveResultState({ status: "COMPLETED", verificationStatus: v.status, objectiveKind: null, steps }).state).toBe("partial");
    // Without the flag (complete work) the memo's rules are unchanged.
    expect(cappedOutcome("ACHIEVED", { acceptedDespiteFailure: false, objectiveKind: null, verificationStatus: "PASS_WITH_WARNINGS", partial: false })).toBe("ACHIEVED");
    // An unverified result stays unmeasured; a lower outcome is never raised.
    expect(cappedOutcome("ACHIEVED", { acceptedDespiteFailure: false, verificationStatus: "UNVERIFIED", partial: true })).toBe("UNKNOWN");
    expect(cappedOutcome("NOT_ACHIEVED", { acceptedDespiteFailure: false, verificationStatus: "PASS", partial: true })).toBe("NOT_ACHIEVED");
  });

  it("a research brief with a skipped step is capped the same way", () => {
    const outcome = cappedOutcome("ACHIEVED", { acceptedDespiteFailure: false, objectiveKind: "research_brief", verificationStatus: "PASS", hasUnsupported: false, partial: true });
    expect(outcome).toBe("PARTIALLY_ACHIEVED");
  });
});

describe("the decision-memo synthesis prompt", () => {
  const synthesis = getCapability("cross_functional_synthesis")!;
  const input: StepRunInput = {
    execution: { id: "x", orgId: "o" },
    objective: { title: "European expansion", statement: "Recommend the next market.", contextNotes: "", deadline: null, kind: null, constraints: null },
    criteria: [{ description: "Recommend a market" }],
    step: { id: "s3", key: "s3", order: 2, title: "Synthesise the result", purpose: "Write the memo.", outputs: [], verification: [], kind: "work", inputs: [], attempts: 1 } as unknown as ExecutionStep,
    totalSteps: 3,
    priorSteps: [],
  };
  const ev = [{ id: "e1", n: 1, kind: "WEB", title: "EU data centers", content: "Germany leads.", url: "https://example.org/a", domain: "example.org" }] as unknown as Evidence[];

  it("lists the skipped and incomplete steps and asks the memo to name them", () => {
    const user = stepUserPrompt({ input, cap: synthesis, companyProfile: "", memories: [], evidence: ev, incomplete: ["“Market sizing” was skipped: its work is missing from this result."] });
    expect(user).toMatch(/Work that is missing or incomplete \(name each under Limitations & uncertainty\):\n- “Market sizing” was skipped: its work is missing from this result\./);
    expect(user).not.toMatch(/External sources you may cite|Deliverable: research brief|Research that is incomplete/);
    expect(stepUserPrompt({ input, cap: synthesis, companyProfile: "", memories: [], evidence: ev, incomplete: [] })).not.toMatch(/Work that is missing/);
    expect(stepSystemPrompt(synthesis, { revision: false })).toMatch(/Under `## Limitations & uncertainty`, name every step the assignment reports as skipped/);
  });
});
