// The "outcome ready" email says what the console says: an outcome nobody confirmed is the AI's
// assessment, a result the AI verifier could not check is not verified, incomplete work is partial,
// and test output (the mock model, a stub model endpoint) is labelled as such.
import { describe, expect, it } from "vitest";
import { attentionEmail, escapeHtml, executionFailedEmail, outcomeReadyEmail, taskCompletedEmail, taskFailedEmail } from "../../src/email/templates";
import { EMAIL_DETAIL, outcomeEmailLabels, outcomeReadyMessage } from "../../src/lib/notify";

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

// The e-mail text for a problem whose console text carries operator detail (machine.ts and notify.ts pass
// EMAIL_DETAIL; tests/integration/problemEmails.test.ts runs those paths with real provider messages).
describe("problem email text", () => {
  it("the verifier was unavailable, planning was blocked, the execution failed: provider-free sentences", () => {
    const base = { name: "Sam", objectiveId: "o1", title: "Q3 pricing memo" };
    const unverified = attentionEmail({ ...base, headline: "A result could not be verified", detail: EMAIL_DETAIL.verifierUnavailable });
    expect(unverified.text.split("\n")[3]).toBe('"Q3 pricing memo": The AI verifier was unavailable, so the result has not been verified. Open the objective to retry or accept it.');
    const blocked = attentionEmail({ ...base, headline: "The AI provider's quota is exhausted", detail: EMAIL_DETAIL.planBlocked });
    expect(blocked.text.split("\n").slice(2, 4)).toEqual(["The AI provider's quota is exhausted", '"Q3 pricing memo": Nothing has run and nothing was charged. Open the objective to retry or cancel.']);
    const failed = executionFailedEmail({ ...base, refundedCents: 120, reason: EMAIL_DETAIL.executionFailed });
    expect(failed.text).toContain('Ensemblis couldn\'t complete "Q3 pricing memo": it stopped before a result was ready. We refunded 120 credits to your organization\'s balance.');
    const rejected = attentionEmail({ ...base, headline: "A result failed verification", detail: EMAIL_DETAIL.verificationFailed });
    expect(rejected.text.split("\n")[3]).toBe('"Q3 pricing memo": The result did not pass verification. Open the objective to review it.');
    for (const m of [unverified, blocked, failed, rejected]) expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|HTTP \d|Owner:|OpenAI|Tavily/);
  });

  it("an attention e-mail's detail (a model's question, a step's title) links nothing", () => {
    const m = attentionEmail({
      name: "Sam",
      objectiveId: "o1",
      title: "Q3 pricing memo",
      headline: "The Chief of Staff has a question",
      detail: "Is the price list at https://other.example/q3 still current? If not, write to sales@other.example.",
    });
    expect(m.text.split("\n")[3]).toBe('"Q3 pricing memo": Is the price list at still current? If not, write to.');
    expect(m.html).toContain("Is the price list at still current? If not, write to.");
    expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/other\.example|sales@/);
  });

  it("an attention e-mail keeps the detail's lines and spacing; only a line with a URL or address changes", () => {
    for (const det of ["Should the brief cover:\n1. pricing\n2. distribution\n3. regulation?", "Is the 12% figure (Eurostat, 2024) still current?  Or use 2023?"]) {
      const m = attentionEmail({ name: "Ann", objectiveId: "o1", title: "Brief", headline: "H", detail: det });
      // Byte for byte what the e-mail said before links were dropped from it.
      expect(m.text.startsWith(["Hi Ann,", "", "H", `"Brief": ${det}`, "", "Review it: "].join("\n"))).toBe(true);
      expect(m.html).toContain(`<strong>Brief</strong>: ${escapeHtml(det)}</p>`);
    }
    const linked = attentionEmail({
      name: "Ann",
      objectiveId: "o1",
      title: "Brief",
      headline: "H",
      detail: "Should the brief cover:\n1. pricing (https://other.example/p)\n2. distribution via sales@other.example\n3. regulation?",
    });
    expect(linked.text.split("\n").slice(3, 7)).toEqual(['"Brief": Should the brief cover:', "1. pricing", "2. distribution via", "3. regulation?"]);
    expect(`${linked.subject} ${linked.text} ${linked.html}`).not.toMatch(/other\.example|sales@/);
  });

  it("an objective's title (the planner may write it) links nothing in any e-mail, subject included", () => {
    const title = "Pricing review of https://other.example/q3";
    const mails = [
      attentionEmail({ name: "N", objectiveId: "o", title, headline: "H", detail: "d" }),
      outcomeReadyEmail({ name: "N", objectiveId: "o", title, result: "Body.", outcomeLabel: "Achieved", verificationLabel: "passed" }),
      executionFailedEmail({ name: "N", objectiveId: "o", title, refundedCents: 0, reason: "r" }),
      taskCompletedEmail({ name: "N", taskId: "t", title, result: "Body." }),
      taskFailedEmail({ name: "N", taskId: "t", title, refundedCents: 0 }),
    ];
    expect(mails.map((m) => m.subject)).toEqual([
      "Needs your attention: Pricing review of",
      "Outcome ready: Pricing review of",
      "Execution stopped: Pricing review of",
      "Your report is ready: Pricing review of",
      "Your task couldn't be completed: Pricing review of",
    ]);
    for (const m of mails) {
      expect(m.text).toContain('"Pricing review of"');
      expect(m.html).toContain("<strong>Pricing review of</strong>");
      expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/other\.example/);
    }
  });

  it("a long title cut mid-word in a subject never becomes an address", () => {
    const address = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,24}(?![\p{L}\p{N}-])/u;
    for (let pad = 0; pad < 40; pad++) {
      const title = `Review ${"x".repeat(pad)}pricing.and.distribution.team.contact@attacker-mail.com-2024 and the next steps for EU`;
      const mails = [
        attentionEmail({ name: "Ada", objectiveId: "ob1", title, headline: "H", detail: "d" }),
        outcomeReadyEmail({ name: "Ada", objectiveId: "ob1", title, result: "Body.", outcomeLabel: "Achieved", verificationLabel: "passed" }),
        executionFailedEmail({ name: "Ada", objectiveId: "ob1", title, refundedCents: 0, reason: "it stopped before a result was ready." }),
      ];
      for (const m of mails) expect(`${m.subject}\n${m.text}\n${m.html}`, `pad=${pad}`).not.toMatch(address);
    }
  });
});
