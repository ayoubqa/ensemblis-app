// Per-criterion evidence (G10) and the research-brief outcome caps (G06, G07):
// the verifier's evidence refs are kept only for sources that exist, a brief's
// evidence criterion that is "met" without any source is only partially met,
// "supported by cited evidence" follows the deterministic evidence check, and
// a brief is ACHIEVED only on a clean PASS. An unverified result is never measured.

import { afterEach, describe, expect, it } from "vitest";
import type { Prisma, SuccessCriterion } from "@prisma/client";
import { setLLMHandlerForTests } from "../../src/ai/llmProvider";
import { assessResult } from "../../src/engine/verification/assessor";
import { applyCriteriaRules, cappedOutcome, measureCriterion, recordOutcome } from "../../src/engine/outcome";
import type { CriterionAssessment, ModelAssessment } from "../../src/engine/verification/checks";

afterEach(() => setLLMHandlerForTests(null));

const KIND = "research_brief";
const verdict = (index: number, status: CriterionAssessment["status"], evidence?: number[]): CriterionAssessment => ({
  index,
  status,
  measuredValue: null,
  measurement: "",
  explanation: "",
  ...(evidence ? { evidence } : {}),
});
const assessment = (criteria: CriterionAssessment[]): ModelAssessment => ({ alignmentScore: 90, alignmentRationale: "", criteria, consistencyIssues: [], humanJudgment: [] });

describe("assessor evidence refs", () => {
  it("drops references to evidence numbers that don't exist in the execution", async () => {
    setLLMHandlerForTests(async () =>
      JSON.stringify({
        objectiveAlignment: { score: 80, rationale: "ok" },
        criteria: [
          { index: 1, status: "MET", evidence: [2, 7, 1, 2] },
          { index: 2, status: "MET", evidence: [42] },
        ],
      })
    );
    const run = await assessResult({
      executionId: "x",
      objectiveTitle: "Brief",
      statement: "Research the German payroll market.",
      criteria: [
        { description: "Findings cite external sources", targetValue: null, unit: null },
        { description: "Gaps are stated", targetValue: null, unit: null },
      ],
      report: "# Brief\n\n- Fact [1]. Fact [2].",
      claimResults: [],
      evidence: [
        { n: 1, kind: "WEB", title: "A" },
        { n: 2, kind: "WIKIPEDIA", title: "B" },
        { n: 3, kind: "COMPANY_CONTEXT", title: "Company profile" },
      ],
    });
    expect(run.assessment!.criteria.map((c) => c.evidence)).toEqual([[1, 2], []]);
  });

  it("measureCriterion carries the refs into the measurement", () => {
    const c = { id: "c1", description: "Findings cite external sources", targetValue: null, unit: null };
    expect(measureCriterion(c, verdict(1, "MET", [3, 1, 3])).evidenceNs).toEqual([1, 3]);
    expect(measureCriterion(c, verdict(1, "MET")).evidenceNs).toEqual([]);
    expect(measureCriterion(c, undefined).evidenceNs).toEqual([]);
  });
});

describe("research-brief criterion rules", () => {
  const criteria = ["Every key finding cites an external source", "Recommendations follow from the findings", "Uses current market data"];

  it("a MET evidence criterion with no evidence refs becomes PARTIALLY_MET ('not linked to evidence')", () => {
    const out = applyCriteriaRules(assessment([verdict(1, "MET", []), verdict(2, "MET", []), verdict(3, "MET")]), { objectiveKind: KIND, criteria })!;
    expect(out.criteria.map((c) => c.status)).toEqual(["PARTIALLY_MET", "MET", "PARTIALLY_MET"]);
    expect(out.criteria[0].explanation).toMatch(/^Not linked to evidence/);
  });

  it("keeps MET when the verdict names its sources, and never touches a non-evidence criterion", () => {
    const out = applyCriteriaRules(assessment([verdict(1, "MET", [2]), verdict(2, "MET")]), { objectiveKind: KIND, criteria: criteria.slice(0, 2) })!;
    expect(out.criteria.map((c) => [c.status, c.evidence])).toEqual([
      ["MET", [2]],
      ["MET", []],
    ]);
  });

  it("maps 'supported by (cited) evidence' from the citation_support check: fail → NOT_MET, warn → PARTIALLY_MET", () => {
    const list = ["Key claims are supported by cited evidence", "Findings are backed by external sources"];
    const model = assessment([verdict(1, "MET", [1]), verdict(2, "MET", [1])]);
    const failed = applyCriteriaRules(model, { objectiveKind: KIND, criteria: list, citationSupport: "fail" })!;
    expect(failed.criteria.map((c) => c.status)).toEqual(["NOT_MET", "NOT_MET"]);
    expect(failed.criteria[0].explanation).toMatch(/evidence-support check failed/);
    const warned = applyCriteriaRules(model, { objectiveKind: KIND, criteria: list, citationSupport: "warn" })!;
    expect(warned.criteria.map((c) => c.status)).toEqual(["PARTIALLY_MET", "PARTIALLY_MET"]);
  });

  it("'cites an external source' is what the evidence check measures too: a brief with no external evidence can't meet it", () => {
    const list = ["Every key finding cites an external source", "Gaps are stated"];
    const out = applyCriteriaRules(assessment([verdict(1, "MET", [1]), verdict(2, "MET")]), { objectiveKind: KIND, criteria: list, citationSupport: "fail" })!;
    expect(out.criteria.map((c) => c.status)).toEqual(["NOT_MET", "MET"]);
  });

  it("a passing evidence check never upgrades the verifier's verdict, and fills refs from the supported claims", () => {
    const list = ["Key claims are supported by cited evidence"];
    expect(applyCriteriaRules(assessment([verdict(1, "NOT_MET", [1])]), { objectiveKind: KIND, criteria: list, citationSupport: "pass" })!.criteria[0].status).toBe("NOT_MET");
    // No verdict from the model: the deterministic check decides, with the supported claims' sources as its refs.
    const filled = applyCriteriaRules(assessment([]), { objectiveKind: KIND, criteria: list, citationSupport: "pass", supportEvidence: [3, 1, 3] })!;
    expect(filled.criteria[0]).toMatchObject({ index: 1, status: "MET", evidence: [1, 3] });
  });

  it("is idempotent, and leaves a decision memo's assessment exactly as the verifier gave it", () => {
    const model = assessment([verdict(1, "MET", []), verdict(2, "MET")]);
    const once = applyCriteriaRules(model, { objectiveKind: KIND, criteria: criteria.slice(0, 2), citationSupport: "warn" });
    expect(applyCriteriaRules(once, { objectiveKind: KIND, criteria: criteria.slice(0, 2), citationSupport: "warn" })).toEqual(once);
    expect(applyCriteriaRules(model, { objectiveKind: null, criteria: ["Key claims are supported by cited evidence", "x"], citationSupport: "fail" })).toBe(model);
    expect(applyCriteriaRules(null, { objectiveKind: KIND, criteria })).toBeNull();
  });
});

describe("outcome caps", () => {
  it("a brief is ACHIEVED only on PASS with no unsupported or uncited claim", () => {
    const base = { acceptedDespiteFailure: false, objectiveKind: KIND };
    expect(cappedOutcome("ACHIEVED", { ...base, verificationStatus: "PASS", hasUnsupported: false })).toBe("ACHIEVED");
    expect(cappedOutcome("ACHIEVED", { ...base, verificationStatus: "PASS_WITH_WARNINGS", hasUnsupported: false })).toBe("PARTIALLY_ACHIEVED");
    expect(cappedOutcome("ACHIEVED", { ...base, verificationStatus: "PASS", hasUnsupported: true })).toBe("PARTIALLY_ACHIEVED");
    expect(cappedOutcome("ACHIEVED", { ...base, verificationStatus: "FAIL", hasUnsupported: false })).toBe("PARTIALLY_ACHIEVED");
    expect(cappedOutcome("NOT_ACHIEVED", { ...base, verificationStatus: "PASS_WITH_WARNINGS" })).toBe("NOT_ACHIEVED");
  });

  it("memos keep the old caps: PASS_WITH_WARNINGS can still be ACHIEVED; accepted failures can't", () => {
    expect(cappedOutcome("ACHIEVED", { acceptedDespiteFailure: false, objectiveKind: null, verificationStatus: "PASS_WITH_WARNINGS", hasUnsupported: true })).toBe("ACHIEVED");
    expect(cappedOutcome("ACHIEVED", { acceptedDespiteFailure: true, objectiveKind: null, verificationStatus: "FAIL" })).toBe("PARTIALLY_ACHIEVED");
  });

  it("an unverified result is never measured", () => {
    expect(cappedOutcome("ACHIEVED", { acceptedDespiteFailure: true, objectiveKind: null, verificationStatus: "UNVERIFIED" })).toBe("UNKNOWN");
  });

  const criterion = (id: string, description: string): SuccessCriterion =>
    ({ id, objectiveId: "o", order: 0, description, kind: "qualitative", targetValue: null, unit: null, source: "user" }) as unknown as SuccessCriterion;
  function fakeTx() {
    const upserts: { create: Record<string, unknown> }[] = [];
    const tx = { outcomeMeasurement: { upsert: async (a: { create: Record<string, unknown> }) => upserts.push(a) } } as unknown as Prisma.TransactionClient;
    return { tx, upserts };
  }

  it("recordOutcome caps ACHIEVED when a brief's verification is not PASS, and stores each criterion's evidence refs", async () => {
    const { tx, upserts } = fakeTx();
    const criteria = [criterion("c1", "Every key finding cites an external source"), criterion("c2", "Recommendations follow from the findings")];
    const model = assessment([verdict(1, "MET", [2, 1]), verdict(2, "MET")]);
    const capped = await recordOutcome(tx, { executionId: "e", criteria, model, acceptedDespiteFailure: false, objectiveKind: KIND, verificationStatus: "PASS_WITH_WARNINGS", hasUnsupported: false });
    expect(capped.status).toBe("PARTIALLY_ACHIEVED");
    expect(upserts.map((u) => [u.create.criterionId, u.create.result, u.create.evidenceNs])).toEqual([
      ["c1", "MET", [1, 2]],
      ["c2", "MET", []],
    ]);
    const clean = await recordOutcome(fakeTx().tx, { executionId: "e", criteria, model, acceptedDespiteFailure: false, objectiveKind: KIND, verificationStatus: "PASS", hasUnsupported: false });
    expect(clean.status).toBe("ACHIEVED");
    // The same verdicts for a memo with warnings stay ACHIEVED (unchanged rules).
    const memo = await recordOutcome(fakeTx().tx, { executionId: "e", criteria, model, acceptedDespiteFailure: false, objectiveKind: null, verificationStatus: "PASS_WITH_WARNINGS", hasUnsupported: true });
    expect(memo.status).toBe("ACHIEVED");
  });

  it("recordOutcome on an UNVERIFIED round records every criterion as not assessed (outcome UNKNOWN)", async () => {
    const { tx, upserts } = fakeTx();
    const r = await recordOutcome(tx, {
      executionId: "e",
      criteria: [criterion("c1", "Gaps are stated")],
      model: assessment([verdict(1, "MET")]),
      acceptedDespiteFailure: false,
      objectiveKind: KIND,
      verificationStatus: "UNVERIFIED",
    });
    expect(r.status).toBe("UNKNOWN");
    expect(upserts[0].create).toMatchObject({ result: "UNKNOWN", method: "not-assessed" });
  });

  it("recordOutcome applies the evidence-link rule to a brief's stored assessment", async () => {
    const { tx, upserts } = fakeTx();
    const r = await recordOutcome(tx, {
      executionId: "e",
      criteria: [criterion("c1", "Every key finding cites an external source")],
      model: assessment([verdict(1, "MET")]),
      acceptedDespiteFailure: false,
      objectiveKind: KIND,
      verificationStatus: "PASS",
      hasUnsupported: false,
    });
    expect(upserts[0].create.result).toBe("PARTIALLY_MET");
    expect(r.status).toBe("PARTIALLY_ACHIEVED");
  });
});
