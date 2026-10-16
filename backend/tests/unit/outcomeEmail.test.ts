// The "outcome ready" email says what the console says: an outcome nobody confirmed is the AI's
// assessment, a result the AI verifier could not check is not verified, incomplete work is partial,
// and test output (the mock model, a stub model endpoint) is labelled as such.
import { describe, expect, it } from "vitest";
import { outcomeReadyEmail } from "../../src/email/templates";
import { outcomeEmailLabels, outcomeReadyMessage } from "../../src/lib/notify";

const done = [
  { kind: "work", status: "COMPLETED", title: "Market scan" },
  { kind: "work", status: "COMPLETED", title: "Synthesis" },
];

describe("outcome email labels", () => {
  it("labels an unconfirmed outcome as AI-assessed, and a confirmed one as confirmed", () => {
    expect(outcomeEmailLabels({ outcomeStatus: "ACHIEVED", verificationStatus: "PASS", steps: done })).toEqual({
      outcomeLabel: "Achieved (AI-assessed)",
      verificationLabel: "passed",
    });
    expect(outcomeEmailLabels({ outcomeStatus: "ACHIEVED", confirmedOutcomeStatus: "NOT_ACHIEVED", verificationStatus: "PASS", steps: done }).outcomeLabel).toBe(
      "Not achieved (confirmed by a person)"
    );
  });

  it("says a result the AI verifier could not check was not verified (never 'not run')", () => {
    expect(outcomeEmailLabels({ outcomeStatus: "UNKNOWN", verificationStatus: "UNVERIFIED", steps: done })).toEqual({
      outcomeLabel: "Not measured",
      verificationLabel: "not verified (the AI verifier could not run; accepted by a person)",
    });
    expect(outcomeEmailLabels({ outcomeStatus: null, verificationStatus: null, steps: done }).verificationLabel).toBe("not run");
  });

  it("says the work was only partially completed when a step was skipped or research didn't deliver", () => {
    const skipped = [...done, { kind: "work", status: "SKIPPED", title: "Pricing" }];
    expect(outcomeEmailLabels({ outcomeStatus: "PARTIALLY_ACHIEVED", verificationStatus: "PASS_WITH_WARNINGS", steps: skipped }).outcomeLabel).toBe(
      "Partially completed — Partially achieved (AI-assessed)"
    );
    const noResearch = [{ kind: "work", status: "COMPLETED", title: "Scan", researchStatus: "failed" }];
    expect(outcomeEmailLabels({ outcomeStatus: "PARTIALLY_ACHIEVED", verificationStatus: "FAIL", steps: noResearch, objectiveKind: "research_brief" })).toEqual({
      outcomeLabel: "Partially completed — Partially achieved (AI-assessed)",
      verificationLabel: "failed (accepted)",
    });
    // A skipped revision is not missing work.
    expect(outcomeEmailLabels({ outcomeStatus: "ACHIEVED", verificationStatus: "PASS", steps: [...done, { kind: "revision", status: "SKIPPED", title: "Revise" }] }).outcomeLabel).toBe(
      "Achieved (AI-assessed)"
    );
  });

  it("reads honestly in the rendered email", () => {
    const labels = outcomeEmailLabels({ outcomeStatus: "UNKNOWN", verificationStatus: "UNVERIFIED", steps: [...done, { kind: "work", status: "SKIPPED", title: "Pricing" }] });
    const mail = outcomeReadyEmail({ name: "Ada", objectiveId: "ob1", title: "EU market brief", result: "# Brief\n\nText.", ...labels });
    expect(mail.text).toContain("Outcome: Partially completed — Not measured. Verification: not verified (the AI verifier could not run; accepted by a person).");
    expect(mail.text).not.toContain("Verification: not run");
    expect(mail.html).toContain("Partially completed — Not measured");
  });

  it("labels mock output and a stub model endpoint in the subject and before the outcome", () => {
    const ex = { objectiveId: "ob1", title: "EU market brief", result: "# Brief\n\nText.", outcomeStatus: "ACHIEVED", verificationStatus: "PASS", steps: done };
    const mock = outcomeReadyMessage("Ada", { ...ex, usedMockAI: true, endpoints: { model: null } });
    expect(mock.subject).toBe("[Mock AI — test output] Outcome ready: EU market brief");
    expect(mock.text).toContain("Outcome: Mock AI — test output — Achieved (AI-assessed). Verification: passed.");
    expect(mock.html).toContain("Mock AI — test output — Achieved (AI-assessed)");

    const stub = outcomeReadyMessage("Ada", { ...ex, usedMockAI: false, endpoints: { model: "stub" } });
    expect(stub.subject).toBe("[Test stub endpoint — not a real model] Outcome ready: EU market brief");
    expect(stub.text).toContain("Outcome: Test stub endpoint — not a real model — Achieved (AI-assessed).");

    // A real model (hosted, or a local endpoint that may be a real model) reads as before.
    for (const model of ["hosted", "local", null] as const) {
      const real = outcomeReadyMessage("Ada", { ...ex, usedMockAI: false, endpoints: { model } });
      expect(real.subject).toBe("Outcome ready: EU market brief");
      expect(`${real.subject} ${real.text} ${real.html}`).not.toMatch(/Mock AI|test stub|not a real model/i);
    }
  });
});
