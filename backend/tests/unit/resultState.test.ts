import { describe, expect, it } from "vitest";
import { deriveResultState, RESULT_STATES, type ResultState, type ResultStateStep } from "../../src/engine/resultState";

const work = (title: string, status = "COMPLETED", researchStatus: string | null = null): ResultStateStep => ({ kind: "work", status, title, researchStatus });
const revision = (status: string): ResultStateStep => ({ kind: "revision", status, title: "Revision", researchStatus: null });

const framing = work("Frame the objective");
const research = (researchStatus: string | null) => work("Research the market", "COMPLETED", researchStatus);
const synthesis = work("Synthesis");
const clean = [framing, research("ok"), synthesis];

interface Case {
  name: string;
  status: string;
  verificationStatus: string | null;
  steps?: ResultStateStep[] | null;
  objectiveKind?: string | null;
  state: ResultState;
  /** Each pattern must match one reason; `reasons: []` asserts there are none. */
  reasons: RegExp[];
}

const cases: Case[] = [
  // Not a result yet
  { name: "planning", status: "PLANNING", verificationStatus: null, steps: [], state: "in_progress", reasons: [] },
  { name: "waiting for plan approval", status: "WAITING_FOR_APPROVAL", verificationStatus: null, steps: [framing], state: "in_progress", reasons: [] },
  { name: "running with a failed search so far", status: "RUNNING", verificationStatus: null, steps: [framing, research("failed")], state: "in_progress", reasons: [/Web research failed in "Research the market"/] },
  { name: "verifying", status: "VERIFYING", verificationStatus: null, steps: clean, state: "in_progress", reasons: [] },
  { name: "blocked", status: "BLOCKED", verificationStatus: null, steps: [framing, work("Research the market", "FAILED")], state: "blocked", reasons: [/Paused until a person/, /"Research the market" failed/] },
  { name: "failed", status: "FAILED", verificationStatus: null, steps: clean, state: "failed", reasons: [/failed before a result/] },
  { name: "cancelled", status: "CANCELLED", verificationStatus: "FAIL", steps: clean, state: "cancelled", reasons: [/cancelled/] },

  // COMPLETED × verification status
  { name: "completed + PASS", status: "COMPLETED", verificationStatus: "PASS", steps: clean, state: "verified", reasons: [] },
  { name: "completed + PASS_WITH_WARNINGS", status: "COMPLETED", verificationStatus: "PASS_WITH_WARNINGS", steps: clean, state: "verified_with_warnings", reasons: [/passed with warnings/] },
  { name: "completed + FAIL (accepted)", status: "COMPLETED", verificationStatus: "FAIL", steps: clean, state: "accepted_failed_verification", reasons: [/Verification failed and the result was accepted/] },
  { name: "completed + UNVERIFIED", status: "COMPLETED", verificationStatus: "UNVERIFIED", steps: clean, state: "unverified", reasons: [/verifier could not run/] },
  { name: "completed with no verification recorded", status: "COMPLETED", verificationStatus: null, steps: clean, state: "unverified", reasons: [/No verification was recorded/] },

  // COMPLETED × incomplete work → partial
  { name: "skipped work step + PASS", status: "COMPLETED", verificationStatus: "PASS", steps: [framing, work("Competitor scan", "SKIPPED"), synthesis], state: "partial", reasons: [/"Competitor scan" was skipped/, /^Verification passed\.$/] },
  { name: "skipped work step + PASS_WITH_WARNINGS", status: "COMPLETED", verificationStatus: "PASS_WITH_WARNINGS", steps: [framing, work("Competitor scan", "SKIPPED"), synthesis], state: "partial", reasons: [/was skipped/, /passed with warnings/] },
  { name: "failed work step at completion", status: "COMPLETED", verificationStatus: "PASS", steps: [framing, work("Competitor scan", "FAILED"), synthesis], state: "partial", reasons: [/"Competitor scan" failed/, /Verification passed/] },
  { name: "research failed + PASS", status: "COMPLETED", verificationStatus: "PASS", steps: [framing, research("failed"), synthesis], state: "partial", reasons: [/Web research failed/, /Verification passed/] },
  { name: "research no_results + PASS_WITH_WARNINGS", status: "COMPLETED", verificationStatus: "PASS_WITH_WARNINGS", steps: [framing, research("no_results"), synthesis], state: "partial", reasons: [/returned no usable sources/, /passed with warnings/] },
  { name: "research off + PASS", status: "COMPLETED", verificationStatus: "PASS", steps: [framing, research("off"), synthesis], state: "partial", reasons: [/Web search is off/, /Verification passed/] },

  // Severity: a failed or missing verification outranks partial work, and both stay in reasons
  { name: "research failed + FAIL (accepted)", status: "COMPLETED", verificationStatus: "FAIL", steps: [framing, research("failed"), synthesis], state: "accepted_failed_verification", reasons: [/Verification failed/, /Web research failed/] },
  { name: "skipped step + UNVERIFIED", status: "COMPLETED", verificationStatus: "UNVERIFIED", steps: [framing, work("Competitor scan", "SKIPPED"), synthesis], state: "unverified", reasons: [/verifier could not run/, /was skipped/] },
  { name: "research off + UNVERIFIED", status: "COMPLETED", verificationStatus: "UNVERIFIED", steps: [framing, research("off"), synthesis], state: "unverified", reasons: [/verifier could not run/, /Web search is off/] },

  // Notes that do not change the state
  { name: "degraded research + PASS", status: "COMPLETED", verificationStatus: "PASS", steps: [framing, research("degraded"), synthesis], state: "verified", reasons: [/degraded: a fallback search provider/] },
  { name: "skipped revision step is normal", status: "COMPLETED", verificationStatus: "PASS", steps: [...clean, revision("SKIPPED")], state: "verified", reasons: [] },
  { name: "a skipped step's research no longer counts", status: "COMPLETED", verificationStatus: "PASS", steps: [framing, work("Old research", "SKIPPED", "failed"), research("ok"), synthesis], state: "partial", reasons: [/"Old research" was skipped/, /Verification passed/] },

  // Research brief
  { name: "brief with successful research", status: "COMPLETED", verificationStatus: "PASS", steps: clean, objectiveKind: "research_brief", state: "verified", reasons: [] },
  { name: "brief whose plan never searched", status: "COMPLETED", verificationStatus: "PASS", steps: [framing, synthesis], objectiveKind: "research_brief", state: "partial", reasons: [/No web research ran for this research brief/, /Verification passed/] },
  { name: "decision memo without research is fine", status: "COMPLETED", verificationStatus: "PASS", steps: [framing, synthesis], objectiveKind: null, state: "verified", reasons: [] },

  // Steps not loaded: only execution-level facts are used
  { name: "summary without steps", status: "COMPLETED", verificationStatus: "PASS", steps: undefined, objectiveKind: "research_brief", state: "verified", reasons: [] },
];

describe("deriveResultState", () => {
  it.each(cases)("$name → $state", (c) => {
    const out = deriveResultState({ status: c.status, verificationStatus: c.verificationStatus, steps: c.steps, objectiveKind: c.objectiveKind ?? null });
    expect(out.state).toBe(c.state);
    if (!c.reasons.length) expect(out.reasons).toEqual([]);
    for (const re of c.reasons) expect(out.reasons.some((r) => re.test(r)), `${re} in ${JSON.stringify(out.reasons)}`).toBe(true);
  });

  it("never reports a completed execution as verified unless verification passed and the work is complete", () => {
    const verifications = ["PASS", "PASS_WITH_WARNINGS", "FAIL", "UNVERIFIED", null];
    const stepSets: ResultStateStep[][] = [clean, [framing, work("X", "SKIPPED"), synthesis], [framing, research("failed"), synthesis], [framing, research("no_results"), synthesis], [framing, research("off"), synthesis]];
    for (const v of verifications) {
      for (const steps of stepSets) {
        const { state } = deriveResultState({ status: "COMPLETED", verificationStatus: v, steps });
        const isVerified = state === "verified" || state === "verified_with_warnings";
        expect(isVerified).toBe((v === "PASS" || v === "PASS_WITH_WARNINGS") && steps === clean);
        expect(RESULT_STATES).toContain(state);
      }
    }
  });

  it("is pure and deterministic", () => {
    const input = { status: "COMPLETED", verificationStatus: "PASS_WITH_WARNINGS", steps: [framing, research("degraded"), synthesis] };
    expect(deriveResultState(input)).toEqual(deriveResultState(structuredClone(input)));
  });
});
