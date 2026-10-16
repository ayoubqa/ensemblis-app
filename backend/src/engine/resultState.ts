// One honest reading of where an execution ended up, derived from fields that
// are persisted separately (execution status, verification status, step and
// research states). It keeps "the work finished" apart from "the result was
// verified": a COMPLETED execution whose verification failed, never ran, or
// whose work was incomplete is never reported as plainly successful.
//
// Pure: no database, no clock. Mirrored in frontend/lib/api.ts (ResultState).

export const RESULT_STATES = [
  "in_progress",
  "blocked",
  "failed",
  "cancelled",
  "verified",
  "verified_with_warnings",
  "partial",
  "unverified",
  "accepted_failed_verification",
] as const;
export type ResultState = (typeof RESULT_STATES)[number];

/** Research outcomes (ExecutionStep.researchStatus) that leave a step without usable web evidence. */
export const INCOMPLETE_RESEARCH = ["failed", "no_results", "off"] as const;

export interface ResultStateStep {
  kind: string; // work | revision
  status: string; // ExecutionStepStatus
  researchStatus?: string | null;
  title?: string | null;
}

export interface ResultStateInput {
  status: string; // ExecutionStatus
  verificationStatus: string | null; // VerificationStatus
  /** Omit when the steps were not loaded: step-based rules are then not applied. */
  steps?: ResultStateStep[] | null;
  objectiveKind?: string | null;
}

export interface ResultStateOutput {
  state: ResultState;
  reasons: string[];
}

const named = (s: ResultStateStep) => (s.title?.trim() ? `"${s.title.trim()}"` : "a step");

/**
 * Step-level facts that make a finished result incomplete (partial) or worth noting.
 * A cancelled or failed execution delivered no result, and ending it marks every step that never ran
 * SKIPPED: those steps are not listed (the state's own reason says the execution ended).
 */
function stepFindings(steps: ResultStateStep[], status: string, objectiveKind: string | null | undefined) {
  const completed = status === "COMPLETED";
  const ended = status === "CANCELLED" || status === "FAILED";
  const incomplete: string[] = [];
  const notes: string[] = [];
  for (const s of steps) {
    const work = s.kind !== "revision";
    if (work && s.status === "SKIPPED") {
      if (completed) incomplete.push(`Step ${named(s)} was skipped, so the result was produced without it.`);
      else if (!ended) incomplete.push(`Step ${named(s)} was skipped.`);
    } else if (work && s.status === "FAILED") incomplete.push(`Step ${named(s)} failed.`);
    else if (work && completed && (s.status === "PENDING" || s.status === "RUNNING")) incomplete.push(`Step ${named(s)} did not finish.`);
    if (s.status === "SKIPPED") continue; // a skipped step's research no longer matters
    switch (s.researchStatus) {
      case "failed":
        incomplete.push(`Web research failed in ${named(s)}: no external sources were retrieved.`);
        break;
      case "no_results":
        incomplete.push(`Web research in ${named(s)} returned no usable sources.`);
        break;
      case "off":
        incomplete.push(`Web search is off on this server, so ${named(s)} ran without web research.`);
        break;
      case "degraded":
        notes.push(`Web research in ${named(s)} was degraded: a fallback search provider was used.`);
        break;
      default:
        break;
    }
  }
  // An evidence-backed brief whose plan never searched the web is not the deliverable that was asked for.
  if (objectiveKind === "research_brief" && completed && steps.length && !steps.some((s) => s.researchStatus)) {
    incomplete.push("No web research ran for this research brief.");
  }
  return { incomplete, notes };
}

/**
 * Why a COMPLETED execution with these steps would be partial (empty when its work is complete).
 * The outcome uses it: incomplete work can't count as fully achieved.
 */
export function incompleteWork(steps: ResultStateStep[], objectiveKind?: string | null): string[] {
  return stepFindings(steps, "COMPLETED", objectiveKind).incomplete;
}

export function deriveResultState(input: ResultStateInput): ResultStateOutput {
  const steps = input.steps ?? [];
  const completed = input.status === "COMPLETED";
  const { incomplete, notes } = input.steps ? stepFindings(steps, input.status, input.objectiveKind) : { incomplete: [], notes: [] };
  const stepReasons = [...incomplete, ...notes];

  if (input.status === "BLOCKED") return { state: "blocked", reasons: ["Paused until a person resolves an open issue.", ...stepReasons] };
  if (input.status === "FAILED") return { state: "failed", reasons: ["The execution failed before a result was delivered.", ...stepReasons] };
  if (input.status === "CANCELLED") return { state: "cancelled", reasons: ["The execution was cancelled.", ...stepReasons] };
  // PLANNING, PLANNED, WAITING_FOR_APPROVAL, RUNNING, VERIFYING — and any unknown status — are not a result yet.
  if (!completed) return { state: "in_progress", reasons: stepReasons };

  // COMPLETED: the order below is by severity; every finding stays in reasons.
  if (input.verificationStatus === "FAIL") {
    return { state: "accepted_failed_verification", reasons: ["Verification failed and the result was accepted as it is.", ...stepReasons] };
  }
  if (input.verificationStatus === "UNVERIFIED") {
    return { state: "unverified", reasons: ["The AI verifier could not run, so this result has not been verified.", ...stepReasons] };
  }
  if (!input.verificationStatus) {
    return { state: "unverified", reasons: ["No verification was recorded for this result.", ...stepReasons] };
  }
  if (incomplete.length) {
    const verdict = input.verificationStatus === "PASS_WITH_WARNINGS" ? "Verification passed with warnings." : "Verification passed.";
    return { state: "partial", reasons: [...stepReasons, verdict] };
  }
  if (input.verificationStatus === "PASS_WITH_WARNINGS") {
    return { state: "verified_with_warnings", reasons: ["Verification passed with warnings.", ...stepReasons] };
  }
  return { state: "verified", reasons: stepReasons };
}
