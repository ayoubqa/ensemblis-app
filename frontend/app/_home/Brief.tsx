// The hero's one bold element: a brief on the desk, in the exact shape every objective ends in (objective,
// success criteria measured, cited findings, a stated limitation, the cost approved before work ran). It is an
// illustration, labelled as one: the markets are placeholders and nothing here is a customer's result.
// On load it fills in once (criteria are measured, the verified sentence is highlighted, the ledger line
// appears); with reduced motion it is shown complete. See docs/design/direction.md.
import { EXAMPLE_PLAN_TOTAL, VERIFICATION_CREDITS } from "@/lib/offer";
import { VERIFICATION_CHECKS } from "./content";

const CRITERIA: { text: string; state: "met" | "partial" }[] = [
  { text: "Three markets, ranked with a rationale", state: "met" },
  { text: "Every recommendation cites its evidence", state: "met" },
  { text: "Entry risks stated for each market", state: "partial" },
];

export function Brief() {
  return (
    <figure className="wp-sheet wp-paper lt" aria-labelledby="wp-sheet-cap">
      <div className="wp-paper-top">
        <span className="wp-paper-name">Example brief</span>
        <span className="wp-paper-state">Verified with warnings</span>
      </div>

      <p className="wp-paper-k">Objective</p>
      <p className="wp-paper-obj">Recommend the three European markets with the most potential for our product next year.</p>

      <p className="wp-paper-k">Success criteria</p>
      <ul className="wp-crit">
        {CRITERIA.map((c, i) => (
          <li key={c.text} data-state={c.state} style={{ "--i": i } as React.CSSProperties}>
            <span className="wp-crit-mark" aria-hidden="true" />
            <span className="wp-crit-text">{c.text}</span>
            <span className="wp-crit-state">{c.state === "met" ? "Met" : "Partially met"}</span>
          </li>
        ))}
      </ul>

      <p className="wp-paper-k">Findings</p>
      <div className="wp-find">
        <p>
          <mark>Market A has the largest addressable segment for the product</mark>
          <sup className="wp-ref">1</sup> and the fewest direct competitors of the three.<sup className="wp-ref">2</sup>
        </p>
        <p>Market C&apos;s entry cost depends on a licence whose current fee is not public.</p>
      </div>
      <p className="wp-limit">
        <b>Could not establish:</b> the licence fee in Market C. Confirm it before deciding.
      </p>

      <ol className="wp-sources" aria-label="Sources in this example">
        <li>Your uploaded market sizing file</li>
        <li>A public industry register</li>
      </ol>

      <p className="wp-ledger">
        <span>Approved before work ran: {EXAMPLE_PLAN_TOTAL.toLocaleString("en-US")} credits</span>
        <span>
          {VERIFICATION_CHECKS.length} checks run, {VERIFICATION_CREDITS} credits included
        </span>
      </p>
      <figcaption id="wp-sheet-cap" className="wp-sheet-cap">
        An illustration of the brief every objective ends in. Markets A and C are placeholders, not a customer&apos;s result.
      </figcaption>
    </figure>
  );
}
