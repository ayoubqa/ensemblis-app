"use client";

import { useState } from "react";
import { api, type Execution, type Objective, type OutcomeStatus } from "@/lib/api";
import { CriterionTag, OutcomeTag, useToast } from "@/components";

export function OutcomePanel({ objective, execution, onExecution }: { objective: Objective; execution: Execution; onExecution: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<OutcomeStatus | null>(null);
  const byCriterion = new Map(execution.measurements.map((m) => [m.criterionId, m]));
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
    <div className="card tight" data-testid="outcome-panel">
      <div className="row between wrapflex" style={{ gap: 8 }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <OutcomeTag outcome={execution.outcomeStatus ?? "UNKNOWN"} />
            {execution.outcomeConfirmedAt && <span className="tiny muted">confirmed by a person</span>}
          </div>
          {execution.outcomeSummary && <p className="small" style={{ marginTop: 6 }}>{execution.outcomeSummary}</p>}
        </div>
      </div>
      <div className="crit" style={{ marginTop: 12 }}>
        {objective.criteria.map((c, i) => {
          const m = byCriterion.get(c.id);
          return (
            <div className="row2" key={c.id}>
              <span className="n">{i + 1}</span>
              <div>
                <div className="small" style={{ fontWeight: 600 }}>
                  {c.description}
                </div>
                {m && (
                  <div className="tiny muted" style={{ marginTop: 3 }}>
                    {m.measurement}
                    {m.explanation ? ` — ${m.explanation}` : ""} <span>({m.method.replace("-", " ")})</span>
                  </div>
                )}
              </div>
              {m ? <CriterionTag result={m.result} /> : <span className="tiny muted">—</span>}
            </div>
          );
        })}
      </div>
      <div className="row wrapflex" style={{ marginTop: 12, gap: 8 }}>
        <span className="small muted">Your judgement:</span>
        {(["ACHIEVED", "PARTIALLY_ACHIEVED", "NOT_ACHIEVED"] as const).map((s) => (
          <button key={s} type="button" className={execution.outcomeStatus === s && execution.outcomeConfirmedAt ? "chip on" : "chip"} onClick={() => confirm(s)} aria-busy={busy === s} disabled={!!busy}>
            {s === "ACHIEVED" ? "Achieved" : s === "PARTIALLY_ACHIEVED" ? "Partially" : "Not achieved"}
          </button>
        ))}
      </div>
    </div>
  );
}
