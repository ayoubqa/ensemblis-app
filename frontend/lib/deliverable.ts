// Labels for a step's deliverable check (backend engine/stepChecks.ts) and the work ledger.
import type { DeliverableStatus, StepDeliverable, WorkLedger } from "./api";

export const DELIVERABLE: Record<DeliverableStatus, { label: string; variant: "ok" | "warn" | "bad" | "gray"; title: string }> = {
  delivered: { label: "Delivered", variant: "ok", title: "The output addresses every expected output of this step, and cites its sources where it gathered any." },
  delivered_with_gaps: { label: "Delivered with gaps", variant: "warn", title: "The step completed, but part of what its plan expected is not clearly in the output." },
  not_delivered: { label: "Not delivered", variant: "bad", title: "The output is too thin to be what the step was planned to deliver." },
  unchecked: { label: "Not checked", variant: "gray", title: "The plan declared nothing to check this step's output against." },
};

/** "2 of 3 expected outputs addressed · cites 2 of its 4 sources" (only the facts that apply). */
export function deliverableFacts(d: StepDeliverable): string {
  const parts: string[] = [];
  if (d.expected.length) parts.push(`${d.expected.filter((e) => e.addressed).length} of ${d.expected.length} expected output${d.expected.length === 1 ? "" : "s"} addressed`);
  if (d.ownEvidence.length) {
    const own = d.citedEvidence.filter((n) => d.ownEvidence.includes(n)).length;
    parts.push(`cites ${own} of its ${d.ownEvidence.length} source${d.ownEvidence.length === 1 ? "" : "s"}`);
  } else if (d.citedEvidence.length) parts.push(`cites ${d.citedEvidence.length} source${d.citedEvidence.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** What the checks flagged, one sentence each. */
export function deliverableGaps(d: StepDeliverable): string[] {
  return d.checks.filter((c) => c.status === "warn" || c.status === "fail").map((c) => c.detail);
}

const LEDGER_ORDER: [keyof WorkLedger, string][] = [
  ["delivered", "delivered"],
  ["delivered_with_gaps", "with gaps"],
  ["unchecked", "not checked"],
  ["not_delivered", "not delivered"],
  ["failed", "failed"],
  ["skipped", "skipped"],
  ["running", "running"],
  ["pending", "not run"],
];

/** "3 delivered · 1 with gaps · 1 skipped", or null when there were no steps. */
export function ledgerSentence(l: WorkLedger | undefined): string | null {
  if (!l) return null;
  const parts = LEDGER_ORDER.filter(([k]) => l[k] > 0).map(([k, label]) => `${l[k]} ${label}`);
  return parts.length ? parts.join(" · ") : null;
}
