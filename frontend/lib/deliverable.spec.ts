import { describe, expect, it } from "vitest";
import { deliverableFacts, deliverableGaps, ledgerSentence } from "./deliverable";

describe("deliverable labels", () => {
  it("states only the facts that apply", () => {
    const d = {
      status: "delivered_with_gaps" as const,
      checks: [
        { key: "substance" as const, status: "pass" as const, detail: "120 words." },
        { key: "expected_outputs" as const, status: "warn" as const, detail: "Not clearly addressed: “Pricing”." },
        { key: "evidence" as const, status: "pass" as const, detail: "Cites 1 of the 2 sources it gathered." },
        { key: "citations" as const, status: "pass" as const, detail: "Every citation points at a real source." },
      ],
      expected: [
        { output: "Market sizing", addressed: true },
        { output: "Pricing", addressed: false },
      ],
      citedEvidence: [2, 5],
      ownEvidence: [2, 3],
    };
    expect(deliverableFacts(d)).toBe("1 of 2 expected outputs addressed · cites 1 of its 2 sources");
    expect(deliverableGaps(d)).toEqual(["Not clearly addressed: “Pricing”."]);
    expect(deliverableFacts({ ...d, expected: [], ownEvidence: [], citedEvidence: [] })).toBe("");
  });

  it("summarises the work ledger, skipping empty states", () => {
    expect(ledgerSentence({ delivered: 3, delivered_with_gaps: 1, unchecked: 0, not_delivered: 0, failed: 0, skipped: 1, pending: 0, running: 0 })).toBe("3 delivered · 1 with gaps · 1 skipped");
    expect(ledgerSentence({ delivered: 0, delivered_with_gaps: 0, unchecked: 0, not_delivered: 0, failed: 0, skipped: 0, pending: 0, running: 0 })).toBeNull();
    expect(ledgerSentence(undefined)).toBeNull();
  });
});
