// Guards the product vocabulary: every lifecycle state has a human label, and
// only in-flight states show the live pulse.
import { describe, expect, it } from "vitest";
import { isLiveStatus, outcomeLabel, statusLabel } from "@/components/Tags";
import type { ExecutionStatus, OutcomeStatus } from "./api";

const ALL: ExecutionStatus[] = ["PLANNING", "PLANNED", "WAITING_FOR_APPROVAL", "RUNNING", "BLOCKED", "VERIFYING", "COMPLETED", "FAILED", "CANCELLED"];

describe("status vocabulary", () => {
  it("labels every execution state", () => {
    for (const s of [...ALL, "DRAFT" as const]) {
      const label = statusLabel(s);
      expect(label).not.toBe(s);
      expect(label.length).toBeGreaterThan(2);
    }
  });
  it("pulses only while work is happening", () => {
    expect(ALL.filter(isLiveStatus).sort()).toEqual(["PLANNING", "RUNNING", "VERIFYING"].sort());
  });
  it("labels outcomes", () => {
    const outcomes: OutcomeStatus[] = ["ACHIEVED", "PARTIALLY_ACHIEVED", "NOT_ACHIEVED", "UNKNOWN"];
    for (const o of outcomes) expect(outcomeLabel(o)).not.toBe(o);
    expect(outcomeLabel(null)).toBe("—");
  });
});
