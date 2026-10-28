// The homepage's signature visual: an execution, set as a ledger. Every name and price comes from the live
// price list (lib/offer.ts → backend registry); only the objective is an example, and it says so.
import { VERIFICATION_CHECKS as CHECKS } from "@/app/_home/content";
import { CAPABILITIES, EXAMPLE_PLAN, TEAM_NAMES, VERIFICATION_CREDITS } from "@/lib/offer";


export function ExecutionLedger({ objective, criteria }: { objective: string; criteria: string[] }) {
  const steps = EXAMPLE_PLAN.map((s) => ({ ...s, cap: CAPABILITIES.find((c) => c.key === s.key)! }));
  const total = steps.reduce((n, s) => n + s.cap.costCredits, 0) + VERIFICATION_CREDITS;
  return (
    <figure className="st-ledger" aria-labelledby="st-ledger-cap">
      <div className="st-ledger-in">
        <div className="st-lg-obj">
          <p className="st-lg-k">Objective</p>
          <p className="st-lg-objtext">{objective}</p>
          <ul className="st-lg-crit" aria-label="Success criteria">
            {criteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>

        <div className="st-lg-planhead">
          <p className="st-lg-k">
            Plan · {steps.length} steps · <b>{total.toLocaleString("en-US")} credits</b>
          </p>
          <span className="st-chip st-chip-ok">Approved by you</span>
        </div>

        <ol className="st-lg-steps">
          {steps.map((s, i) => (
            <li key={s.key} style={{ "--i": i } as React.CSSProperties}>
              <span className="st-lg-node" aria-hidden="true" />
              <span className="st-lg-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="st-lg-cap">
                {s.cap.name}
                <span className="st-lg-team">{TEAM_NAMES[s.cap.team]}</span>
              </span>
              <span className="st-lg-ev" aria-label={s.evidence.length ? `Evidence ${s.evidence.join(", ")}` : undefined}>
                {s.evidence.map((n) => (
                  <span key={n}>[{n}]</span>
                ))}
              </span>
              <span className="st-lg-cost">{s.cap.costCredits}</span>
            </li>
          ))}
          <li className="st-lg-verify" style={{ "--i": steps.length } as React.CSSProperties}>
            <span className="st-lg-node st-lg-node-ok" aria-hidden="true" />
            <span className="st-lg-n">✓</span>
            <span className="st-lg-cap">
              Verification gate
              <span className="st-lg-team">{CHECKS.length} checks · passed with 1 warning</span>
            </span>
            <span className="st-lg-ev" />
            <span className="st-lg-cost">{VERIFICATION_CREDITS}</span>
          </li>
        </ol>

        <div className="st-lg-out">
          <p className="st-lg-k">Outcome</p>
          <p>
            <b>
              {criteria.length - 1} of {criteria.length} criteria met, 1 partially
            </b>{" "}
            · 6 sources cited · limits stated
          </p>
        </div>
      </div>
      <figcaption id="st-ledger-cap" className="st-lg-cap-note">
        Illustration: an example objective, planned with today&apos;s price list. Not a customer result.
      </figcaption>
    </figure>
  );
}
