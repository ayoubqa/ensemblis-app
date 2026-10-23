// Did a step deliver what its plan said it would? Deterministic checks of one
// step's output against the step's own plan (no model call, no cost):
//
//   substance         the output says something (word count)
//   expected_outputs  each output the plan declared for the step is addressed
//                     (its key terms appear in the output)
//   evidence          a step that gathered sources cites them; a synthesis
//                     cites the execution's sources when there are any
//   citations         no citation pointed at a source that doesn't exist
//
// The verdict is stored on the step (ExecutionStep.deliverable) and shown in
// the work ledger. A step that plainly delivered nothing (an output too thin to
// be a deliverable: "not_delivered") is never completed when it is an
// intermediate step: the executor treats it as a failed attempt, so a model that
// merely replied is not taken as a step that did its work. The result itself
// (synthesis, revisions) keeps its verdict and is judged by the verification gate. Gaps (an expected output not clearly addressed, sources
// gathered but not cited) are recorded and shown, not failed. These are coverage
// checks, not proof of truth: the result as a whole is verified against the
// objective by engine/verification.

import { terms } from "../context/retrieval";
import { parseCitations } from "./verification/checks";

export type StepCheckStatus = "pass" | "warn" | "fail" | "not_assessed";
export type DeliverableStatus = "delivered" | "delivered_with_gaps" | "not_delivered" | "unchecked";

export interface StepCheck {
  key: "substance" | "expected_outputs" | "evidence" | "citations";
  status: StepCheckStatus;
  detail: string;
}

export interface StepDeliverable {
  status: DeliverableStatus;
  checks: StepCheck[];
  /** Expected outputs (from the plan) and whether the output addresses each. */
  expected: { output: string; addressed: boolean }[];
  /** Evidence numbers [n] the output cites. */
  citedEvidence: number[];
  /** Evidence numbers this step gathered itself. */
  ownEvidence: number[];
  words: number;
  version: 1;
}

/** Below this many words a step has delivered nothing usable. */
export const MIN_WORDS = 12;
const SHORT_WORDS = 60;
/** Share of an expected output's key terms that must appear for it to count as addressed. */
const ADDRESSED_SHARE = 0.5;

/** Plural/inflection-insensitive key terms ("markets" and "market" match). */
function stems(text: string): string[] {
  return terms(text).map((w) => (w.length > 4 ? w.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, "") : w));
}

export function addressed(output: string, expected: string): boolean {
  const want = [...new Set(stems(expected))];
  if (!want.length) return true;
  const have = new Set(stems(output));
  return want.filter((w) => have.has(w)).length / want.length >= ADDRESSED_SHARE;
}

export function assessStep(args: {
  output: string;
  /** The plan's expected outputs for the step (ExecutionStep.outputs). */
  expectedOutputs: string[];
  kind: "work" | "revision";
  capabilityKind: string; // registry Capability.kind: research | analysis | synthesis | …
  /** The capability searches the web (it gathers its own sources). */
  searchesWeb: boolean;
  /** Evidence numbers of the sources this step gathered. */
  ownEvidence: number[];
  /** How many evidence items the execution has in total. */
  evidenceCount: number;
  /** Citations to non-existent sources the cleaner removed. */
  citationsRemoved: number;
}): StepDeliverable {
  const words = args.output.trim() ? args.output.trim().split(/\s+/).length : 0;
  const cited = parseCitations(args.output).filter((n) => n >= 1 && n <= args.evidenceCount);
  const checks: StepCheck[] = [];

  // Substance.
  checks.push(
    words < MIN_WORDS
      ? { key: "substance", status: "fail", detail: `The output has only ${words} word${words === 1 ? "" : "s"}.` }
      : words < SHORT_WORDS
        ? { key: "substance", status: "warn", detail: `The output is short (${words} words).` }
        : { key: "substance", status: "pass", detail: `${words} words.` }
  );

  // Expected outputs (a revision step's job is the verifier's feedback, not the plan's outputs).
  const expectedList = args.kind === "revision" ? [] : args.expectedOutputs.map((o) => o.trim()).filter(Boolean).slice(0, 12);
  const expected = expectedList.map((o) => ({ output: o, addressed: addressed(args.output, o) }));
  if (!expected.length) {
    checks.push({ key: "expected_outputs", status: "not_assessed", detail: args.kind === "revision" ? "A revision answers the verifier's feedback." : "The plan declared no expected outputs for this step." });
  } else {
    // Term coverage is a signal, not proof (an expected output may be a label like "Market facts"):
    // it can flag a gap, never fail a step on its own.
    const missing = expected.filter((e) => !e.addressed).map((e) => e.output);
    if (!missing.length) checks.push({ key: "expected_outputs", status: "pass", detail: `All ${expected.length} expected output${expected.length === 1 ? " is" : "s are"} addressed.` });
    else checks.push({ key: "expected_outputs", status: "warn", detail: `Not clearly addressed: ${missing.map((m) => `“${m}”`).join(", ")}.` });
  }

  // Evidence.
  const ownCited = cited.filter((n) => args.ownEvidence.includes(n));
  if (args.searchesWeb && args.ownEvidence.length) {
    checks.push(
      ownCited.length
        ? { key: "evidence", status: "pass", detail: `Cites ${ownCited.length} of the ${args.ownEvidence.length} source${args.ownEvidence.length === 1 ? "" : "s"} it gathered.` }
        : { key: "evidence", status: "warn", detail: `Gathered ${args.ownEvidence.length} source${args.ownEvidence.length === 1 ? "" : "s"} but cites none of them.` }
    );
  } else if (args.searchesWeb) {
    checks.push({ key: "evidence", status: "warn", detail: "Gathered no sources (see its research status)." });
  } else if (args.capabilityKind === "synthesis" && args.evidenceCount > 0) {
    checks.push(
      cited.length
        ? { key: "evidence", status: "pass", detail: `Cites ${cited.length} of the execution's ${args.evidenceCount} source${args.evidenceCount === 1 ? "" : "s"}.` }
        : { key: "evidence", status: "warn", detail: `The execution has ${args.evidenceCount} source${args.evidenceCount === 1 ? "" : "s"}, and the result cites none.` }
    );
  } else {
    checks.push({ key: "evidence", status: "not_assessed", detail: cited.length ? `Cites ${cited.length} source${cited.length === 1 ? "" : "s"}.` : "This step works from earlier steps, not its own sources." });
  }

  // Citations.
  checks.push(
    args.citationsRemoved > 0
      ? { key: "citations", status: "warn", detail: `${args.citationsRemoved} citation${args.citationsRemoved === 1 ? "" : "s"} to sources that don't exist ${args.citationsRemoved === 1 ? "was" : "were"} removed.` }
      : { key: "citations", status: "pass", detail: "Every citation points at a real source." }
  );

  const status: DeliverableStatus = checks.some((c) => c.status === "fail")
    ? "not_delivered"
    : checks.some((c) => c.status === "warn")
      ? "delivered_with_gaps"
      : checks.find((c) => c.key === "expected_outputs")?.status === "pass"
        ? "delivered"
        : "unchecked";
  return { status, checks, expected, citedEvidence: cited, ownEvidence: [...args.ownEvidence].sort((a, b) => a - b), words, version: 1 };
}

/** One line for an event message or an error: why a step was not delivered. */
export function notDeliveredReason(d: StepDeliverable): string {
  return d.checks.filter((c) => c.status === "fail").map((c) => c.detail).join(" ");
}

// ---------------------------------------------------------------- public shape and work ledger

const DELIVERABLE_STATUSES: readonly string[] = ["delivered", "delivered_with_gaps", "not_delivered", "unchecked"];
const CHECK_STATUSES: readonly string[] = ["pass", "warn", "fail", "not_assessed"];
const CHECK_KEYS: readonly string[] = ["substance", "expected_outputs", "evidence", "citations"];

export interface PublicDeliverable {
  status: DeliverableStatus;
  checks: StepCheck[];
  expected: { output: string; addressed: boolean }[];
  citedEvidence: number[];
  ownEvidence: number[];
}

/** The stored verdict, validated (an unknown or malformed value reads as null). */
export function toPublicDeliverable(v: unknown): PublicDeliverable | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Partial<StepDeliverable>;
  if (!d.status || !DELIVERABLE_STATUSES.includes(d.status)) return null;
  const nums = (a: unknown) => (Array.isArray(a) ? a.filter((n): n is number => Number.isInteger(n) && n >= 1).slice(0, 100) : []);
  return {
    status: d.status,
    checks: (Array.isArray(d.checks) ? d.checks : [])
      .filter((c): c is StepCheck => !!c && CHECK_KEYS.includes(c.key) && CHECK_STATUSES.includes(c.status) && typeof c.detail === "string")
      .map((c) => ({ key: c.key, status: c.status, detail: c.detail.slice(0, 400) })),
    expected: (Array.isArray(d.expected) ? d.expected : [])
      .filter((e) => !!e && typeof e.output === "string")
      .slice(0, 12)
      .map((e) => ({ output: e.output.slice(0, 200), addressed: !!e.addressed })),
    citedEvidence: nums(d.citedEvidence),
    ownEvidence: nums(d.ownEvidence),
  };
}

export type LedgerState = DeliverableStatus | "failed" | "skipped" | "pending" | "running";

/**
 * Where every step of an execution stands, for the outcome report: delivered, delivered with gaps,
 * not checked (no expected outputs to check against), failed, skipped, or not finished. A completed
 * step from before deliverable checks existed counts as "unchecked", never as delivered.
 */
export function workLedger(steps: { status: string; kind: string; deliverable: unknown }[]) {
  const counts: Record<LedgerState, number> = { delivered: 0, delivered_with_gaps: 0, not_delivered: 0, unchecked: 0, failed: 0, skipped: 0, pending: 0, running: 0 };
  for (const s of steps) {
    if (s.kind === "revision" && s.status !== "COMPLETED") continue; // an unrun revision is not missing work
    const state: LedgerState =
      s.status === "COMPLETED"
        ? toPublicDeliverable(s.deliverable)?.status ?? "unchecked"
        : s.status === "FAILED"
          ? "failed"
          : s.status === "SKIPPED"
            ? "skipped"
            : s.status === "RUNNING"
              ? "running"
              : "pending";
    counts[state]++;
  }
  return counts;
}
