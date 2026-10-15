"use client";

// "What is happening now": the console's live summary card.

import type { ExceptionItem, Execution, Objective, ResultState } from "@/lib/api";
import { Icon, statusLabel } from "@/components";
import { outcomeTagLabel } from "@/components/Tags";
import { ExecBadge } from "@/components/ops";
import { resultStateOf } from "@/lib/openIssues";
import { eur, relativeTime } from "@/lib/format";
import type { StreamState } from "./useObjectiveLive";

type Tone = "live" | "wait" | "ok" | "bad" | "idle";

/** How a completed execution reads: only a verified, complete result is plainly good. */
const COMPLETED: Partial<Record<ResultState, { tone: Tone; title: string }>> = {
  verified: { tone: "ok", title: "Completed and verified" },
  verified_with_warnings: { tone: "wait", title: "Completed — verified with warnings" },
  partial: { tone: "wait", title: "Completed — partial result" },
  unverified: { tone: "wait", title: "Completed — not verified" },
  accepted_failed_verification: { tone: "wait", title: "Completed — accepted without passing verification" },
};

function StreamBadge({ stream }: { stream: StreamState }) {
  if (stream === "live")
    return (
      <span className="cs-now-stream is-live">
        <span className="pulse" aria-hidden="true" />
        Live
      </span>
    );
  if (stream === "reconnecting") return <span className="cs-now-stream">Reconnecting…</span>;
  if (stream === "polling") return <span className="cs-now-stream">Updating every few seconds</span>;
  return null;
}

export function NowCard({
  objective,
  execution: ex,
  stream,
  openException,
}: {
  objective: Objective;
  execution: Execution | null;
  stream: StreamState;
  openException: ExceptionItem | null;
}) {
  const work = ex?.steps ?? [];
  const working = work.filter((s) => s.status === "RUNNING");
  const done = ex?.progress.done ?? 0;
  const total = ex?.progress.total ?? 0;
  const current = working[0] ? work.indexOf(working[0]) + 1 : Math.min(done + 1, total);

  let tone: Tone = "idle";
  let title = "";
  let sub: string | null = null;
  let cta: { href: string; label: string } | null = null;
  let cta2: { href: string; label: string } | null = null;
  const result = ex ? resultStateOf(ex) : null;

  if (!ex) {
    title = objective.status === "DRAFT" ? "Draft — not planned yet" : statusLabel(objective.status);
    sub = "Nothing has been planned or charged. Send it to the Chief of Staff when you're ready.";
  } else
    switch (ex.status) {
      case "PLANNING":
        tone = "live";
        title = "The Chief of Staff is planning";
        sub = "Reading your company context and memory, choosing capabilities and pricing the plan.";
        break;
      case "PLANNED":
        tone = "live";
        title = "Plan ready";
        sub = "The AI Team starts once the plan is cleared to proceed.";
        break;
      case "WAITING_FOR_APPROVAL":
        tone = "wait";
        title = "Waiting for your approval";
        sub = "Nothing is charged until you approve the plan.";
        cta = { href: "#cs-attention", label: "Review the plan" };
        break;
      case "RUNNING":
        tone = "live";
        title = "The AI Team is executing";
        sub = total ? `Step ${current} of ${total}` : null;
        break;
      case "BLOCKED":
        tone = "wait";
        title = "Paused — needs your input";
        sub = openException?.title ?? "An exception needs your decision.";
        cta = openException ? { href: "#cs-attention", label: "Resolve it" } : null;
        break;
      case "VERIFYING":
        tone = "live";
        title = "Verifying the result";
        sub = "Checking it against the evidence and your success criteria.";
        break;
      case "COMPLETED": {
        const m = (result && COMPLETED[result]) || { tone: "ok" as Tone, title: "Completed" };
        tone = m.tone;
        title = m.title;
        const outcome = ex.confirmedOutcomeStatus ?? ex.outcomeStatus;
        // The first reason that explains the result (not the verdict itself).
        const why = result !== "verified" ? (ex.resultReasons ?? []).find((r) => !/^Verification passed/i.test(r)) : null;
        sub = [
          `${relativeTime(ex.completedAt)}.`,
          why ?? null,
          ex.outcomeSummary ?? (outcome ? `Outcome: ${outcomeTagLabel(outcome, !!ex.confirmedOutcomeStatus)}.` : null),
        ]
          .filter(Boolean)
          .join(" ");
        cta = ex.result ? { href: "#result", label: "Read the report" } : null;
        cta2 = result !== "verified" ? { href: "#open-issues", label: "See what is open" } : null;
        break;
      }
      case "FAILED":
        tone = "bad";
        title = "Execution failed";
        sub = ex.refundedCents > 0 ? `${eur(ex.refundedCents, { decimals: true })} was refunded.` : "Completed work and the event log are kept.";
        break;
      case "CANCELLED":
        tone = "idle";
        title = "Execution cancelled";
        sub = ex.refundedCents > 0 ? `${eur(ex.refundedCents, { decimals: true })} was refunded.` : "Nothing more will be executed.";
        break;
    }

  const showProgress = !!ex && total > 0 && ex.status !== "PLANNING";
  const pct = total ? Math.round((done / total) * 100) : 0;
  const announce = ex ? (ex.status === "COMPLETED" ? title : statusLabel(ex.status)) : statusLabel(objective.status);

  return (
    <section className={`cs-now tone-${tone}`} aria-labelledby="cs-now-h" data-testid="live-card" data-result-state={result ?? undefined}>
      <div className="cs-now-top">
        <h2 id="cs-now-h" className="cs-now-k" tabIndex={-1}>
          Now
        </h2>
        <StreamBadge stream={stream} />
      </div>
      <p className="cs-now-t">{title}</p>
      {sub && <p className="cs-now-s">{sub}</p>}

      {showProgress && (
        <div className="cs-now-prog">
          <div className="cs-segs" role="progressbar" aria-label="Execution progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            {work.map((s) => (
              <i key={s.id} className={`st-${s.status}`} />
            ))}
          </div>
          <div className="cs-now-pl">
            <span>
              {done} of {total} steps done
            </span>
            {ex && ex.verification && (
              <span>
                {ex.verification.status === "UNVERIFIED"
                  ? "Not verified"
                  : ex.verification.status === "FAIL"
                    ? `Failed verification ${ex.verification.score}/100`
                    : `Verification ${ex.verification.score}/100`}
              </span>
            )}
          </div>
        </div>
      )}

      {working.length > 0 && (
        <ul className="cs-now-work">
          {working.map((s) => (
            <li key={s.id}>
              <ExecBadge executive={s.executive} size={28} />
              <span>
                <b>{s.agent}</b>
                <span className="cs-now-ws">
                  {s.executiveTitle} · {s.title}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {ex?.status === "PLANNING" && (
        <ul className="cs-now-work">
          <li>
            <ExecBadge executive="chief_of_staff" size={28} />
            <span>
              <b>Chief of Staff</b>
              <span className="cs-now-ws">Planning the work</span>
            </span>
          </li>
        </ul>
      )}

      {(cta || cta2) && (
        <div className="cs-now-ctas">
          {[cta, cta2].filter((c): c is { href: string; label: string } => !!c).map((c) => (
            <a key={c.href} href={c.href} className="cs-now-cta">
              {c.label}
              <Icon name="arrow" size={14} />
            </a>
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        Status: {announce}
      </p>
    </section>
  );
}
