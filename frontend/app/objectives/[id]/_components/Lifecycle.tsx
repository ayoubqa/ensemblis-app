"use client";

// The objective's lifecycle — Objective → Plan → Approval → Execution →
// Verification → Evidence → Outcome — derived from the real execution state.
// Drives the stepper under the console header and the stage markers of each section.

import type { ExceptionItem, Execution, Objective } from "@/lib/api";
import { Icon, outcomeLabel } from "@/components";

export type StageState = "done" | "current" | "attention" | "failed" | "stopped" | "todo" | "skipped";
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
  if (x?.kind === "INSUFFICIENT_FUNDS") return 2;
  return ex.plan && ex.steps.length ? 2 : 1;
}

/** Furthest stage a failed or cancelled execution reached. */
function reachedAt(ex: Execution): number {
  if (ex.verification) return 4;
  if (ex.costCents > 0 || ex.steps.some((s) => s.status !== "PENDING")) return 3;
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

  const notes: Record<StageKey, { note: string; tone: Tone }> = {
    objective: { note: o.criteria.length ? `${o.criteria.length} success ${o.criteria.length === 1 ? "criterion" : "criteria"}` : "Defined", tone: null },
    plan: {
      note: !ex ? "Not planned yet" : ex.status === "PLANNING" ? "Planning…" : work ? `${work} ${work === 1 ? "step" : "steps"}` : at === 1 && mode === "wait" ? "Needs information" : "",
      tone: null,
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
    execution: { note: ex && ex.progress.total ? `${ex.progress.done} of ${ex.progress.total} steps` : "", tone: null },
    verification: {
      note: v ? `${v.score}/100` : ex?.status === "VERIFYING" ? "Checking…" : "",
      tone: v ? (v.status === "PASS" ? "ok" : v.status === "PASS_WITH_WARNINGS" ? "warn" : "bad") : null,
    },
    evidence: { note: evidence ? `${evidence} ${evidence === 1 ? "source" : "sources"}` : "", tone: null },
    outcome: {
      note: ex?.status === "COMPLETED" ? outcomeLabel(ex.outcomeStatus ?? "UNKNOWN") : "",
      tone: ex?.outcomeStatus === "ACHIEVED" ? "ok" : ex?.outcomeStatus === "PARTIALLY_ACHIEVED" ? "warn" : ex?.outcomeStatus === "NOT_ACHIEVED" ? "bad" : null,
    },
  };

  return KEYS.map((key, i) => {
    let state: StageState;
    if (i === 0) state = "done";
    else if (mode === "complete") state = "done";
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
      ) : state === "attention" ? (
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
      {now && (
        <p className={`cs-life-now is-${now.state}`} aria-hidden="true">
          <span className="cs-life-now-k">Stage {now.n} of 7</span> {now.label}
          {now.note ? ` — ${now.note}` : ""}
        </p>
      )}
    </nav>
  );
}
