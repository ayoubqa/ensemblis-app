// "What you get": the anatomy of a finished result. The sections are the ones the synthesis step must produce
// (lib/offer.ts → backend registry); the verification checks are the gate's real checks. The content is a
// labelled example — never presented as a real customer's result.
import { VERIFICATION_CHECKS } from "@/app/_home/content";

const NOTES = [
  { n: 1, title: "The answer comes first", body: "An executive summary that answers the objective directly — not a wall of text to dig through." },
  { n: 2, title: "Every claim shows its evidence", body: "Numbered citations point to web sources, your documents or your Company Context. Inference is labelled as inference." },
  { n: 3, title: "Each success criterion, measured", body: "Met, partially met or not met — against the criteria you set before the work started." },
  { n: 4, title: "A verification report you can read", body: "Five checks run before anything is called done. A result that fails is revised or escalated to you, never quietly passed." },
  { n: 5, title: "Limits stated, not hidden", body: "What the evidence doesn't cover and what a person should confirm before acting." },
];

function Marker({ n }: { n: number }) {
  return (
    <span className="st-an-marker" aria-hidden="true">
      {n}
    </span>
  );
}

export function ReportAnatomy() {
  return (
    <div className="st-anatomy">
      <figure className="st-doc" aria-labelledby="st-doc-cap">
        {/* Only the paper uses the light palette; the caption below sits on the page background. */}
        <div className="st-doc-page lt">
          <p className="st-doc-kicker">Outcome report · Example</p>
          <p className="st-doc-title">Where to expand in Europe next year</p>

          <div className="st-doc-sec">
            <Marker n={1} />
            <p className="st-doc-h">Executive summary</p>
            <p className="st-doc-p">
              Prioritise <b>Market A</b>, then <b>Market B</b> and <b>Market C</b>. Market A combines the largest addressable segment for your
              product <span className="st-cite">[1]</span> with the weakest local competition <span className="st-cite">[4]</span>; Market C carries
              the highest regulatory entry cost <span className="st-cite">[3]</span>.
            </p>
          </div>

          <div className="st-doc-sec">
            <Marker n={2} />
            <p className="st-doc-h">Recommendation</p>
            <table className="st-doc-table">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Market</th>
                  <th scope="col">Why</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td>Market A</td>
                  <td>Largest segment, fewer direct rivals</td>
                  <td className="st-cite">[1] [4]</td>
                </tr>
                <tr>
                  <td>2</td>
                  <td>Market B</td>
                  <td>Fast growth, price-sensitive buyers</td>
                  <td className="st-cite">[2] [6]</td>
                </tr>
                <tr>
                  <td>3</td>
                  <td>Market C</td>
                  <td>Strong demand, costly to enter</td>
                  <td className="st-cite">[3] [5]</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="st-doc-sec st-doc-two">
            <div>
              <Marker n={3} />
              <p className="st-doc-h">Success criteria</p>
              <ul className="st-doc-crit">
                <li>
                  <span className="st-met">Met</span> 3 markets, ranked with a rationale
                </li>
                <li>
                  <span className="st-met">Met</span> Every recommendation cites evidence
                </li>
                <li>
                  <span className="st-part">Partially met</span> Entry risks stated for each market
                </li>
              </ul>
            </div>
            <div>
              <Marker n={4} />
              <p className="st-doc-h">Verification</p>
              <ul className="st-doc-checks">
                {VERIFICATION_CHECKS.map((c, i) => (
                  <li key={c} className={i === 3 ? "warn" : undefined}>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="st-doc-sec">
            <Marker n={5} />
            <p className="st-doc-h">Limitations &amp; next steps</p>
            <p className="st-doc-p">Entry-risk evidence for Market C is from one source; confirm licensing costs with a local adviser before committing budget.</p>
          </div>

          <p className="st-doc-foot">
            <span>[1]–[6] numbered evidence</span>
            <span>Export PDF · Word · read-only share link</span>
          </p>
        </div>
        <figcaption id="st-doc-cap" className="st-lg-cap-note">
          Example of the result format with placeholder markets — not a customer result.
        </figcaption>
      </figure>

      <ol className="st-notes">
        {NOTES.map((n) => (
          <li key={n.n}>
            <span className="st-an-marker" aria-hidden="true">
              {n.n}
            </span>
            <div>
              <h3>{n.title}</h3>
              <p>{n.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
