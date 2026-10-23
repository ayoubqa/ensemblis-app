import { describe, expect, it } from "vitest";
import { addressed, assessStep, toPublicDeliverable, workLedger } from "../../src/engine/stepChecks";

const LONG = (extra: string) => `${extra} ${"The analysis covers the relevant segments, demand drivers and constraints in detail. ".repeat(6)}`;
const base = { kind: "work" as const, capabilityKind: "analysis", searchesWeb: false, ownEvidence: [], evidenceCount: 0, citationsRemoved: 0 };

describe("step deliverable checks", () => {
  it("matches expected outputs on their key terms, ignoring plurals", () => {
    expect(addressed("We ranked the three markets by demand.", "Ranked list of markets")).toBe(true);
    expect(addressed("Germany leads on demand.", "Competitor comparison table")).toBe(false);
    expect(addressed("anything", "")).toBe(true);
  });

  it("delivered: every expected output addressed, the sources it gathered cited", () => {
    const d = assessStep({ ...base, capabilityKind: "research", searchesWeb: true, ownEvidence: [2, 3], evidenceCount: 3, output: LONG("Market sizing for Germany [2] and France [3]."), expectedOutputs: ["Market sizing", "Country shortlist: Germany, France"] });
    expect(d.status).toBe("delivered");
    expect(d.citedEvidence).toEqual([2, 3]);
    expect(d.expected.every((e) => e.addressed)).toBe(true);
  });

  it("gaps are recorded, not failed: an expected output not addressed, sources not cited, invented citations removed", () => {
    const d = assessStep({ ...base, capabilityKind: "research", searchesWeb: true, ownEvidence: [1], evidenceCount: 1, citationsRemoved: 2, output: LONG("Market sizing for Germany."), expectedOutputs: ["Market sizing", "Pricing benchmarks"] });
    expect(d.status).toBe("delivered_with_gaps");
    const byKey = Object.fromEntries(d.checks.map((c) => [c.key, c]));
    expect(byKey.expected_outputs).toMatchObject({ status: "warn", detail: expect.stringMatching(/Pricing benchmarks/) });
    expect(byKey.evidence).toMatchObject({ status: "warn", detail: "Gathered 1 source but cites none of them." });
    expect(byKey.citations.status).toBe("warn");
  });

  it("not delivered: an output too thin to be the step's deliverable", () => {
    const d = assessStep({ ...base, output: "OK, done.", expectedOutputs: ["Competitor comparison"] });
    expect(d.status).toBe("not_delivered");
    expect(d.checks.find((c) => c.key === "substance")).toMatchObject({ status: "fail", detail: "The output has only 2 words." });
  });

  it("unchecked when the plan declared nothing to check against; a revision is judged by the verifier's feedback", () => {
    expect(assessStep({ ...base, output: LONG("Findings."), expectedOutputs: [] }).status).toBe("unchecked");
    const rev = assessStep({ ...base, kind: "revision", capabilityKind: "synthesis", output: LONG("Revised result."), expectedOutputs: ["Final result"] });
    expect(rev.expected).toEqual([]);
    expect(rev.checks.find((c) => c.key === "expected_outputs")?.status).toBe("not_assessed");
  });

  it("a synthesis is expected to cite the execution's sources when there are any", () => {
    const none = assessStep({ ...base, capabilityKind: "synthesis", evidenceCount: 4, output: LONG("Result."), expectedOutputs: ["Result"] });
    expect(none.checks.find((c) => c.key === "evidence")?.status).toBe("warn");
    const cites = assessStep({ ...base, capabilityKind: "synthesis", evidenceCount: 4, output: LONG("Result [1][4]. Out of range [9]."), expectedOutputs: ["Result"] });
    expect(cites.citedEvidence).toEqual([1, 4]);
    expect(cites.status).toBe("delivered");
  });

  it("the public shape rejects malformed stored values; the ledger never counts an old step as delivered", () => {
    expect(toPublicDeliverable(null)).toBeNull();
    expect(toPublicDeliverable({ status: "great" })).toBeNull();
    const d = toPublicDeliverable({ status: "delivered", checks: [{ key: "substance", status: "pass", detail: "ok" }, { key: "evil", status: "pass", detail: "x" }], expected: [{ output: "A", addressed: 1 }], citedEvidence: [1, -1, "2"], ownEvidence: [] });
    expect(d).toEqual({ status: "delivered", checks: [{ key: "substance", status: "pass", detail: "ok" }], expected: [{ output: "A", addressed: true }], citedEvidence: [1], ownEvidence: [] });
    expect(
      workLedger([
        { status: "COMPLETED", kind: "work", deliverable: { status: "delivered", checks: [] } },
        { status: "COMPLETED", kind: "work", deliverable: null }, // completed before the check existed
        { status: "FAILED", kind: "work", deliverable: null },
        { status: "SKIPPED", kind: "work", deliverable: null },
        { status: "PENDING", kind: "revision", deliverable: null }, // an unrun revision is not missing work
        { status: "PENDING", kind: "work", deliverable: null },
      ])
    ).toEqual({ delivered: 1, delivered_with_gaps: 0, not_delivered: 0, unchecked: 1, failed: 1, skipped: 1, pending: 1, running: 0 });
  });
});
