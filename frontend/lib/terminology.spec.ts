// Guards the product vocabulary: every lifecycle state has a human label, and
// only in-flight states show the live pulse.
import { describe, expect, it } from "vitest";
import {
  AI_ASSESSED,
  claimTypeLabel,
  exceptionKindLabel,
  isLiveStatus,
  outcomeLabel,
  outcomeTagLabel,
  researchStatusLabel,
  resultReportLabel,
  resultStateLabel,
  resultStateTone,
  statusLabel,
  verificationLabel,
} from "@/components/Tags";
import { RESULT_STATES, type ClaimType, type ExceptionKind, type ExecutionStatus, type OutcomeStatus, type ResearchStatus, type VerificationStatus } from "./api";

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

describe("honest result vocabulary", () => {
  it("labels every verification status, and UNVERIFIED reads 'Not verified'", () => {
    const all: VerificationStatus[] = ["PASS", "PASS_WITH_WARNINGS", "FAIL", "UNVERIFIED"];
    for (const v of all) expect(verificationLabel(v)).not.toBe(v);
    expect(verificationLabel("UNVERIFIED")).toBe("Not verified");
    expect(verificationLabel("PASS")).toBe("Verified");
  });

  it("gives every result state a label, a tone and a report label", () => {
    expect(RESULT_STATES).toHaveLength(9);
    for (const s of RESULT_STATES) {
      expect(resultStateLabel(s)).not.toBe(s);
      expect(resultStateLabel(s).length).toBeGreaterThan(3);
      expect(["accent", "ok", "warn", "bad", "gray"]).toContain(resultStateTone(s));
      expect(resultReportLabel(s).length).toBeGreaterThan(3);
    }
    // Only a verified result reads as plainly good.
    expect(RESULT_STATES.filter((s) => resultStateTone(s) === "ok")).toEqual(["verified"]);
    expect(resultStateTone("accepted_failed_verification")).toBe("bad");
    expect(resultStateLabel("partial")).toBe("Partial result");
    expect(resultReportLabel("accepted_failed_verification")).toMatch(/did not pass verification/i);
    expect(resultReportLabel("verified")).toBe("Verified report");
  });

  it("says an outcome is AI-assessed unless a person confirmed it", () => {
    for (const o of ["ACHIEVED", "PARTIALLY_ACHIEVED", "NOT_ACHIEVED"] as const) {
      expect(outcomeTagLabel(o)).toBe(`${outcomeLabel(o)} ${AI_ASSESSED}`);
      expect(outcomeTagLabel(o, false)).toContain("(AI-assessed)");
      expect(outcomeTagLabel(o, true)).toBe(outcomeLabel(o));
    }
    expect(outcomeTagLabel("ACHIEVED")).toBe("Achieved (AI-assessed)");
    // Nothing was assessed: no suffix.
    expect(outcomeTagLabel("UNKNOWN")).toBe("Not measured");
    expect(outcomeTagLabel(null)).toBe("—");
  });

  it("labels every exception kind, including PROVIDER_UNAVAILABLE", () => {
    const kinds: ExceptionKind[] = ["MISSING_INFORMATION", "STEP_FAILED", "VERIFICATION_FAILED", "INSUFFICIENT_FUNDS", "POLICY_BLOCKED", "PROVIDER_UNAVAILABLE"];
    for (const k of kinds) expect(exceptionKindLabel(k)).not.toBe(k);
    expect(exceptionKindLabel("PROVIDER_UNAVAILABLE")).toBe("Provider unavailable");
    // A kind this build doesn't know yet still reads as words.
    expect(exceptionKindLabel("SOMETHING_NEW")).toBe("Something new");
  });

  it("labels research outcomes and claim types", () => {
    const research: ResearchStatus[] = ["ok", "degraded", "no_results", "failed", "off"];
    for (const r of research) expect(researchStatusLabel(r)).not.toBe(r);
    const types: ClaimType[] = ["source", "inference", "uncertainty", "recommendation"];
    for (const t of types) expect(claimTypeLabel(t)).not.toBe(t);
  });
});
