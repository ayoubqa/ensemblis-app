"use client";

// The objective's lifecycle — Objective → Plan → Approval → Execution →
// Verification → Evidence → Outcome — derived from the real execution state.
// Drives the stepper under the console header and the stage markers of each section.
// A finished execution follows its result state: a verification that failed or never ran,
// skipped work and research that didn't deliver are never marked plainly done.

import type { ExceptionItem, Execution, Objective } from "@/lib/api";
import { Icon } from "@/components";
import { outcomeTagLabel, verificationLabel } from "@/components/Tags";
import { resultStateOf } from "@/lib/openIssues";

/** warn: the stage finished, with issues (a skipped step, research that failed, a verifier that could not run). */
export type StageState = "done" | "warn" | "current" | "attention" | "failed" | "stopped" | "todo" | "skipped";
export type StageKey = "objective" | "plan" | "approval" | "execution" | "verification" | "evidence" | "outcome";
export type Tone = "ok" | "warn" | "bad" | null;

export interface StageInfo {
  key: StageKey;
  n: number;
  label: string;
  state: StageState;
  note: string;
  tone: Tone;
  /** Section anchor in the console. */
  anchor: string;
}

export const STAGE_ANCHOR: Record<StageKey, string> = {
  objective: "cs-objective",
  plan: "cs-plan",
  approval: "cs-approval",
  execution: "cs-execution",
  verification: "verification",
  evidence: "evidence",
  outcome: "outcome",
};

const LABEL: Record<StageKey, string> = {
  objective: "Objective",
  plan: "Plan",
  approval: "Approval",
  execution: "Execution",
  verification: "Verification",
  evidence: "Evidence",
  outcome: "Outcome",
};

const KEYS: StageKey[] = ["objective", "plan", "approval", "execution", "verification", "evidence", "outcome"];

/** Index of the stage an exception pauses. */
function blockedAt(ex: Execution, x: ExceptionItem | null): number {
  if (x?.kind === "VERIFICATION_FAILED") return 4;
  if (ex.costCents > 0) return 3;
  // The model or search provider was unavailable while planning: nothing was charged.
  if (x?.kind === "PROVIDER_UNAVAILABLE") return 1;
  if (x?.kind === "INSUFFICIENT_FUNDS") return 2;
  return ex.plan && ex.steps.length ? 2 : 1;
}

/**
 * Furthest stage a failed or cancelled execution reached. Rejecting or cancelling a
 * plan marks its untouched steps SKIPPED: only an execution that started (`startedAt`,
 * set when it is charged) or a step that actually ran counts as execution, so a rejected
 * plan stops at Approval instead of reading as approved.
 */
function reachedAt(ex: Execution): number {
  if (ex.verification) return 4;
  if (ex.startedAt || ex.costCents > 0 || ex.steps.some((s) => s.status !== "PENDING" && s.status !== "SKIPPED")) return 3;
  return ex.plan ? 2 : 1;
}

export function lifecycle(o: Objective, ex: Execution | null, openException: ExceptionItem | null): StageInfo[] {
  let at = 1;
  let mode: "live" | "wait" | "failed" | "stopped" | "idle" | "complete" = "idle";
  if (ex) {
    switch (ex.status) {
      case "PLANNING":
        at = 1;
        mode = "live";
        break;
      case "PLANNED":
        at = 2;
        mode = "live";
        break;
      case "WAITING_FOR_APPROVAL":
        at = 2;
        mode = "wait";
        break;
      case "RUNNING":
        at = 3;
        mode = "live";
        break;
      case "BLOCKED":
        at = blockedAt(ex, openException);
        mode = "wait";
        break;
      case "VERIFYING":
        at = 4;
        mode = "live";
        break;
      case "COMPLETED":
        at = 7;
        mode = "complete";
        break;
      case "FAILED":
        at = reachedAt(ex);
        mode = "failed";
        break;
      case "CANCELLED":
        at = reachedAt(ex);
        mode = "stopped";
        break;
    }
  }

  const work = ex?.steps.filter((s) => s.kind === "work").length ?? 0;
  const approvals = ex?.approvals ?? [];
  const pending = approvals.find((a) => a.status === "PENDING");
  const decided = [...approvals].reverse().find((a) => a.status !== "PENDING");
  const v = ex?.verification ?? null;
  const evidence = ex?.evidence.length ?? 0;
  const result = ex ? resultStateOf(ex) : null;
  const workSteps = ex?.steps.filter((s) => s.kind === "work") ?? [];
  const skipped = workSteps.filter((s) => s.status === "SKIPPED").length;
  const failedSteps = workSteps.filter((s) => s.status === "FAILED").length;
  // Research that left a step without usable web evidence (a skipped step's research no longer matters).
  const researchGap = (ex?.steps ?? []).some((s) => s.status !== "SKIPPED" && (s.researchStatus === "failed" || s.researchStatus === "no_results" || s.researchStatus === "off"));
  const outcome = ex?.confirmedOutcomeStatus ?? ex?.outcomeStatus ?? null;
  const blocked = ex?.plan?.blocked ?? null;

  const notes: Record<StageKey, { note: string; tone: Tone }> = {
    objective: { note: o.criteria.length ? `${o.criteria.length} success ${o.criteria.length === 1 ? "criterion" : "criteria"}` : "Defined", tone: null },
    plan: {
      note: !ex
        ? "Not planned yet"
        : ex.status === "PLANNING"
          ? "Planning…"
          : blocked && ex.status === "BLOCKED"
            ? blocked.kind === "search_unavailable"
              ? "Web search unavailable"
              : blocked.kind === "quota"
                ? "AI provider out of quota"
                : "AI provider not configured"
            : work
              ? `${work} ${work === 1 ? "step" : "steps"}`
              : at === 1 && mode === "wait"
                ? "Needs information"
                : "",
      tone: blocked && ex?.status === "BLOCKED" ? "warn" : null,
    },
    approval: {
      note: pending
        ? "Awaiting you"
        : decided
          ? decided.status === "APPROVED"
            ? "Approved"
            : decided.status === "REJECTED"
              ? "Rejected"
              : "Withdrawn"
          : ex && at > 2 && o.autonomy === "AUTO_WITHIN_BUDGET"
            ? "Within budget"
            : "",
      tone: decided?.status === "REJECTED" ? "bad" : null,
    },
    execution: {
      note:
        ex && ex.progress.total
          ? `${ex.progress.done} of ${ex.progress.total} steps${skipped ? ` · ${skipped} skipped` : ""}${failedSteps && ex.status === "COMPLETED" ? ` · ${failedSteps} failed` : ""}`
          : "",
      tone: skipped || (failedSteps && ex?.status === "COMPLETED") ? "warn" : null,
    },
    verification: {
      note: v
        ? v.status === "UNVERIFIED"
          ? verificationLabel("UNVERIFIED")
          : `${v.score}/100${result === "accepted_failed_verification" ? " · accepted" : ""}`
        : ex?.status === "VERIFYING"
          ? "Checking…"
          : ex?.status === "COMPLETED"
            ? "Not verified"
            : "",
      tone: v ? (v.status === "PASS" ? "ok" : v.status === "PASS_WITH_WARNINGS" || v.status === "UNVERIFIED" ? "warn" : "bad") : ex?.status === "COMPLETED" ? "warn" : null,
    },
    evidence: {
      note: researchGap ? `${evidence ? `${evidence} ${evidence === 1 ? "source" : "sources"} · ` : ""}research incomplete` : evidence ? `${evidence} ${evidence === 1 ? "source" : "sources"}` : "",
      tone: researchGap ? "warn" : null,
    },
    outcome: {
      note: ex?.status === "COMPLETED" ? outcomeTagLabel(outcome ?? "UNKNOWN", !!ex.confirmedOutcomeStatus) : "",
      tone: outcome === "ACHIEVED" ? "ok" : outcome === "PARTIALLY_ACHIEVED" ? "warn" : outcome === "NOT_ACHIEVED" ? "bad" : null,
    },
  };

  /** A finished execution: each stage reads as its result did, not plainly "done". */
  const completeState = (key: StageKey): StageState => {
    if (key === "verification") {
      if (result === "accepted_failed_verification") return "failed";
      if (result === "unverified") return "warn";
    }
    if (key === "execution" && (skipped || failedSteps)) return "warn";
    if (key === "evidence" && researchGap) return "warn";
    return "done";
  };

  return KEYS.map((key, i) => {
    let state: StageState;
    if (i === 0) state = "done";
    else if (mode === "complete") state = completeState(key);
    else if (!ex) state = "todo";
    else if (key === "evidence") {
      // Evidence accrues while the AI Team executes.
      if (at > 4 || (at >= 4 && evidence)) state = "done";
      else if (at === 3 && evidence) state = mode === "live" ? "current" : "done";
      else state = mode === "failed" || mode === "stopped" ? (at >= 3 && evidence ? "done" : "skipped") : "todo";
    } else if (i < at) state = "done";
    else if (i === at) state = mode === "live" ? "current" : mode === "wait" ? "attention" : mode === "failed" ? "failed" : mode === "stopped" ? "stopped" : "todo";
    else state = mode === "failed" || mode === "stopped" ? "skipped" : "todo";
    const note = notes[key];
    // A paused stage always says why (an exception can pause a stage that has no note of its own).
    if (state === "attention" && !note.note) return { key, n: i + 1, label: LABEL[key], state, anchor: STAGE_ANCHOR[key], note: "Needs your input", tone: "warn" as Tone };
    return { key, n: i + 1, label: LABEL[key], state, anchor: STAGE_ANCHOR[key], ...note };
  });
}

const STATE_TEXT: Record<StageState, string> = {
  done: "done",
  warn: "done, with issues",
  current: "in progress",
  attention: "needs your attention",
  failed: "failed",
  stopped: "stopped",
  todo: "not started",
  skipped: "not reached",
};

/** Small marker shared by the stepper and the section headings. */
export function StageMark({ state, n, size = "md" }: { state: StageState; n: number | null; size?: "sm" | "md" }) {
  return (
    <span className={`cs-mark is-${state} cs-mark-${size}`} aria-hidden="true">
      {state === "done" ? (
        <Icon name="check" size={size === "sm" ? 12 : 14} />
      ) : state === "failed" || state === "stopped" ? (
        <Icon name="x" size={size === "sm" ? 12 : 14} />
      ) : state === "attention" || state === "warn" ? (
        "!"
      ) : n === null ? null : (
        n
      )}
    </span>
  );
}

/** The lifecycle stepper. Each stage links to its section when it is on the page. */
export function LifecycleStepper({ stages, present }: { stages: StageInfo[]; present: Set<StageKey> }) {
  const now = stages.find((s) => s.state === "current" || s.state === "attention" || s.state === "failed" || s.state === "stopped") ?? null;
  // A finished execution with issues: the narrow-screen line names the first stage that has them.
  const shown = now ?? stages.find((s) => s.state === "warn") ?? null;
  return (
    <nav className="cs-life" aria-label="Lifecycle">
      <ol>
        {stages.map((s) => {
          const inner = (
            <>
              <StageMark state={s.state} n={s.n} size="sm" />
              <span className="cs-life-t">
                <span className="cs-life-l">{s.label}</span>
                <span className={`cs-life-n${s.tone ? ` t-${s.tone}` : ""}`}>{s.note || " "}</span>
              </span>
              <span className="sr-only">
                {" "}
                — {STATE_TEXT[s.state]}
                {s.note ? `, ${s.note}` : ""}
              </span>
            </>
          );
          return (
            <li key={s.key} className={`is-${s.state}`} aria-current={now?.key === s.key ? "step" : undefined}>
              {present.has(s.key) ? (
                <a href={`#${s.anchor}`} className="cs-life-i">
                  {inner}
                </a>
              ) : (
                <span className="cs-life-i">{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
      {shown && (
        <p className={`cs-life-now is-${shown.state}`} aria-hidden="true">
          <span className="cs-life-now-k">Stage {shown.n} of 7</span> {shown.label}
          {shown.note ? ` — ${shown.note}` : ""}
        </p>
      )}
    </nav>
  );
}
