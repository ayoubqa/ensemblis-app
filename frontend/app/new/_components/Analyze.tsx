"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskEstimate } from "@/lib/api";
import { Flow, Icon } from "@/components";
import { eur, minutesRange } from "@/lib/format";
import { useKeyboardShortcut } from "@/lib/hooks";
import { DEPTH_INFO } from "./draft";

const CHECKS = [
  "Identifying task type",
  "Determining required capabilities",
  "Estimating complexity",
  "Breaking the work into steps",
  "Evaluating agent performance on similar work",
  "Estimating cost and delivery time",
];
const STEP_MS = 320; // 6 × 320ms ≈ 1.9s minimum, so the analysis feels considered

export function complexityOf(est: TaskEstimate): string {
  const n = est.team.length;
  return n <= 2 ? "Moderate" : n === 3 ? "High" : "Very high";
}

export function Analyze({
  description,
  estimate,
  error,
  instant,
  onRetry,
  onBack,
  onContinue,
  onAnimated,
}: {
  description: string;
  estimate: TaskEstimate | null;
  error: string | null;
  /** Skip the checklist animation (e.g. navigating back to this step). */
  instant: boolean;
  onRetry: () => void;
  onBack: () => void;
  onContinue: () => void;
  onAnimated: () => void;
}) {
  const [tick, setTick] = useState(instant ? CHECKS.length : 0);
  const reportedRef = useRef(false);

  useEffect(() => {
    if (instant) return;
    const t = setInterval(() => setTick((n) => (n >= CHECKS.length ? n : n + 1)), STEP_MS);
    return () => clearInterval(t);
  }, [instant]);

  // The last check only completes once the real estimate has landed.
  const done = Math.min(tick, estimate ? CHECKS.length : CHECKS.length - 1);
  const finished = done >= CHECKS.length && !!estimate;
  useEffect(() => {
    if (finished && !reportedRef.current) {
      reportedRef.current = true;
      onAnimated();
    }
  }, [finished, onAnimated]);

  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (finished && !instant) continueRef.current?.focus({ preventScroll: true });
  }, [finished, instant]);
  useKeyboardShortcut("mod+enter", () => finished && onContinue(), { allowInInputs: true, enabled: finished });

  return (
    <div className="narrow">
      <Flow step={0} />
      <div className="eyebrow" style={{ marginTop: 16 }}>
        UNDERSTANDING YOUR REQUEST
      </div>
      <h1 className="serif" style={{ fontSize: "clamp(26px,4vw,38px)", margin: "0 0 6px", lineHeight: 1.1, minHeight: "1.1em" }}>
        {estimate ? estimate.title : <span className="muted">Reading your brief<span className="caret" /></span>}
      </h1>
      <p className="small muted" style={{ marginBottom: 14, maxWidth: "70ch" }}>
        “{description.length > 220 ? description.slice(0, 218) + "…" : description}”
      </p>

      {error ? (
        <div className="card" role="alert">
          <div className="notice" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>
            <Icon name="alert" />
            <span>{error}</span>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={onBack}>
              <Icon name="back" />
              Edit task
            </button>
            <button type="button" className="btn p" onClick={onRetry}>
              <Icon name="redo" />
              Try again
            </button>
          </div>
        </div>
      ) : (
        <ul className="chk" aria-live="polite" aria-label="Analysis progress">
          {CHECKS.map((x, i) => (
            <li key={x} className={i < done ? "done" : i === done && !finished ? "doing" : ""}>
              <span className="ic">
                <Icon name="check" />
              </span>
              {x}
              <span className="sr-only">{i < done ? " — done" : i === done ? " — in progress" : ""}</span>
            </li>
          ))}
        </ul>
      )}

      {finished && estimate && (
        <div>
          <div className="card reveal" style={{ marginTop: 8 }}>
            <div className="grid g2 keep2" style={{ gap: 18 }}>
              <div>
                <div className="tiny muted">Task</div>
                <b>{estimate.title}</b>
              </div>
              <div>
                <div className="tiny muted">Category</div>
                <b>{estimate.category}</b>
              </div>
              <div>
                <div className="tiny muted">Complexity</div>
                <b>
                  {complexityOf(estimate)} · {DEPTH_INFO[estimate.depth].label} depth
                </b>
              </div>
              <div>
                <div className="tiny muted">Estimated execution</div>
                <b>{minutesRange(estimate.estMinutesLow, estimate.estMinutesHigh).replace("min", "minutes")}</b>
              </div>
              <div>
                <div className="tiny muted">Estimated cost</div>
                <b>{eur(estimate.costCents)}</b>
              </div>
              <div>
                <div className="tiny muted">Done manually</div>
                <b>~{estimate.manualHoursEstimate} hours</b>
              </div>
            </div>
            <hr className="hr" />
            <div className="tiny muted" style={{ marginBottom: 8 }}>
              Required capabilities
            </div>
            <div className="row wrapflex" style={{ gap: 8 }}>
              {estimate.capabilities.map((c, i) => (
                <span key={c} className="chip reveal" style={{ animationDelay: `${i * 70}ms` }}>
                  <Icon name="check" />
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div
            className="card reveal"
            style={{ marginTop: 14, borderColor: "var(--accent)", background: "var(--accent-soft)", animationDelay: "120ms" }}
          >
            <div className="row between wrapflex">
              <div>
                <b style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 500 }}>Ensemblis has created an execution plan.</b>
                <div className="small muted">
                  {estimate.team.length === 1
                    ? "One specialized agent, matched to the work."
                    : `${estimate.team.length} specialized agents, matched to the work.`}
                </div>
              </div>
              <button ref={continueRef} type="button" className="btn p lg" onClick={onContinue}>
                Review plan <Icon name="arrow" />
              </button>
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button type="button" className="btn ghost sm" onClick={onBack}>
              <Icon name="back" />
              Edit task
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
