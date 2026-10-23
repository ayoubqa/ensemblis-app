"use client";

import { useState } from "react";
import { api, type Execution, type Objective, type OutcomeMeasurement, type OutcomeStatus } from "@/lib/api";
import { CriterionTag, Icon, outcomeLabel, useToast, type IconName } from "@/components";
import { outcomeTagLabel } from "@/components/Tags";
import { relativeTime } from "@/lib/format";
import { EvidenceChips } from "./Evidence";
import { ledgerSentence } from "@/lib/deliverable";

const METHOD: Record<OutcomeMeasurement["method"], string> = {
  "model-assessed": "Assessed by AI review",
  deterministic: "Measured",
  "not-assessed": "Not assessed",
  "user-confirmed": "Confirmed by a person",
};

const OUTCOME_ICON: Record<OutcomeStatus, IconName> = { ACHIEVED: "check", PARTIALLY_ACHIEVED: "flag", NOT_ACHIEVED: "x", UNKNOWN: "info" };

const JUDGMENTS = [
  ["ACHIEVED", "Achieved"],
  ["PARTIALLY_ACHIEVED", "Partially achieved"],
  ["NOT_ACHIEVED", "Not achieved"],
] as const;

/**
 * `readOnly` (an earlier attempt): confirming an outcome also sets the objective's outcome,
 * so only the current attempt takes a judgment; an earlier one shows the recorded one.
 */
export function OutcomePanel({ objective, execution, onExecution, readOnly = false }: { objective: Objective; execution: Execution; onExecution: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<OutcomeStatus | null>(null);
  const byCriterion = new Map(execution.measurements.map((m) => [m.criterionId, m]));
  // A person's confirmation and the AI's assessment are kept apart. Before they were (no
  // confirmedOutcomeStatus), a confirmation overwrote outcomeStatus: it is then the person's value.
  const confirmedValue = execution.confirmedOutcomeStatus ?? (execution.outcomeConfirmedAt ? execution.outcomeStatus : null);
  const aiValue = execution.confirmedOutcomeStatus ? execution.outcomeStatus : execution.outcomeConfirmedAt ? null : execution.outcomeStatus;
  const confirmed = !!confirmedValue;
  const status = confirmedValue ?? aiValue ?? "UNKNOWN";
  const ledger = ledgerSentence(execution.workLedger);
  const confirm = async (s: Exclude<OutcomeStatus, "UNKNOWN">) => {
    setBusy(s);
    try {
      await api.confirmOutcome(execution.id, s);
      toast("Outcome confirmed");
      onExecution();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="cs-card cs-out" data-testid="outcome-panel">
      <div className="cs-out-head">
        <span className={`cs-out-badge o-${status}`} aria-hidden="true">
          <Icon name={OUTCOME_ICON[status]} size={20} />
        </span>
        <div className="cs-out-tt">
          <p className="cs-out-v">{outcomeTagLabel(status, confirmed)}</p>
          {execution.outcomeSummary && <p className="cs-out-sum">{execution.outcomeSummary}</p>}
          {ledger && (
            <p className="cs-out-ledger" data-testid="work-ledger">
              <Icon name="list" size={13} /> Work: {ledger}.{" "}
              <a href="#cs-execution" className="cs-inline-link">
                See each step
              </a>
            </p>
          )}
          <p className="cs-out-basis" data-testid="outcome-basis" data-confirmed={confirmed ? "true" : "false"}>
            {confirmed
              ? `Confirmed by a person.${
                  aiValue && aiValue !== confirmedValue
                    ? ` The AI verifier assessed it as ${outcomeLabel(aiValue).toLowerCase()}.`
                    : aiValue
                      ? " The AI verifier's assessment was the same."
                      : ""
                }`
              : status === "UNKNOWN"
                ? "The AI verifier could not measure the outcome. Confirm it yourself below."
                : "The AI verifier's reading of the report against your success criteria — not a measurement of the business result. Not confirmed by a person."}
          </p>
        </div>
        {execution.outcomeConfirmedAt && (
          <span className="cs-out-conf">
            <Icon name="user" size={13} />
            Confirmed {relativeTime(execution.outcomeConfirmedAt)}
          </span>
        )}
      </div>

      {/* An earlier attempt is shown against the objective's current criteria. When none of them
          has a measurement from this attempt (criteria replaced since — their results go with them),
          say so instead of labelling every current criterion "Not measured". */}
      {readOnly && objective.criteria.length > 0 && !objective.criteria.some((c) => byCriterion.has(c.id)) ? (
        <p className="cs-crit-gone">
          The per-criterion results of this attempt are no longer available: the success criteria may have changed since it ran. Its verification,
          evidence and report are unchanged.
        </p>
      ) : (
      <ol className="cs-crit" aria-label="Success criteria results">
        {objective.criteria.map((c, i) => {
          const m = byCriterion.get(c.id);
          return (
            <li key={c.id}>
              <span className="cs-crit-n" aria-hidden="true">
                {i + 1}
              </span>
              <div className="cs-crit-b">
                <p className="cs-crit-t">{c.description}</p>
                {m && (
                  <p className="cs-crit-m">
                    {m.measurement}
                    {m.explanation ? ` — ${m.explanation}` : ""}
                    <span className="cs-crit-how">{METHOD[m.method] ?? m.method}</span>
                  </p>
                )}
                {m && (m.evidenceNs?.length ?? 0) > 0 && (
                  <p className="cs-crit-ev">
                    <EvidenceChips ns={m.evidenceNs ?? []} label="Evidence" />
                  </p>
                )}
              </div>
              {m ? <CriterionTag result={m.result} /> : <span className="cs-crit-none">Not measured</span>}
            </li>
          );
        })}
      </ol>
      )}

      {readOnly ? (
        <div className="cs-judge">
          <div className="cs-judge-tt">
            <p className="cs-judge-l">Your judgment</p>
            <p className="cs-judge-h">
              {confirmedValue
                ? `Confirmed as ${outcomeLabel(confirmedValue).toLowerCase()} ${relativeTime(execution.outcomeConfirmedAt)}.`
                : "Not confirmed by a person for this attempt."}
            </p>
          </div>
        </div>
      ) : (
      <div className="cs-judge" role="group" aria-labelledby={`judge-${execution.id}`}>
        <div className="cs-judge-tt">
          <p id={`judge-${execution.id}`} className="cs-judge-l">
            Your judgment
          </p>
          <p className="cs-judge-h">Was the outcome achieved? Your answer is recorded with this result, next to the AI&apos;s assessment — it doesn&apos;t replace it.</p>
        </div>
        <div className="cs-seg">
          {JUDGMENTS.map(([s, label]) => {
            const on = confirmedValue === s;
            return (
              <button key={s} type="button" className={on ? "on" : undefined} aria-pressed={on} onClick={() => confirm(s)} aria-busy={busy === s} disabled={!!busy}>
                {on && <Icon name="check" size={13} />}
                {label}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {!readOnly && <FeedbackBlock execution={execution} />}
    </div>
  );
}

/** "Was this result useful?" — a yes/no with an optional comment, for the team building Ensemblis. */
function FeedbackBlock({ execution }: { execution: Execution }) {
  const toast = useToast();
  const [saved, setSaved] = useState(execution.feedback ?? null);
  const [choice, setChoice] = useState<boolean | null>(execution.feedback?.useful ?? null);
  const [comment, setComment] = useState(execution.feedback?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const send = async (useful: boolean, text: string) => {
    setBusy(true);
    try {
      const r = await api.sendFeedback(execution.id, useful, text.trim() || undefined);
      setSaved(r.feedback);
      toast("Thanks — feedback saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const dirty = choice !== null && (saved?.useful !== choice || (saved?.comment ?? "") !== comment.trim());
  return (
    <div className="cs-judge cs-fb" role="group" aria-labelledby={`fb-${execution.id}`} data-testid="result-feedback">
      <div className="cs-judge-tt">
        <p id={`fb-${execution.id}`} className="cs-judge-l">
          Was this result useful?
        </p>
        <p className="cs-judge-h">{saved ? `You said ${saved.useful ? "it was useful" : "it wasn't useful"}. You can change your answer.` : "Your answer goes to the team building Ensemblis — not into the report."}</p>
      </div>
      <div className="cs-seg">
        {([
          [true, "Useful"],
          [false, "Not useful"],
        ] as const).map(([v, label]) => (
          <button key={label} type="button" className={choice === v ? "on" : undefined} aria-pressed={choice === v} onClick={() => setChoice(v)} disabled={busy}>
            {choice === v && <Icon name="check" size={13} />}
            {label}
          </button>
        ))}
      </div>
      {choice !== null && (
        <form
          className="cs-fb-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(choice, comment);
          }}
        >
          <label className="sr-only" htmlFor={`fb-c-${execution.id}`}>
            Comment (optional)
          </label>
          <input
            id={`fb-c-${execution.id}`}
            className="f"
            maxLength={500}
            placeholder={choice ? "What made it useful? (optional)" : "What was missing? (optional)"}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="submit" className="btn p sm" disabled={busy || !dirty} aria-busy={busy}>
            {saved ? "Update" : "Send"}
          </button>
        </form>
      )}
    </div>
  );
}
