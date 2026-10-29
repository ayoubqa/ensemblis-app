import Image from "next/image";
import approval from "@/public/site/product/approval-card.png";
import verification from "@/public/site/product/verification-gate.png";

// Two moments of the real product, captured from a local test run (scripted, on the test AI provider): the plan
// arrives with its cost for approval, and the verification gate reports its checks. The interface is real; the
// objective, scores and wording are test data — the captions say so, and the "(Mock AI)" label stays visible.
export function ProductShots() {
  return (
    <div className="st-shots">
      <figure className="st-shot">
        <div className="st-shot-frame">
          <Image src={approval} alt="An approval card: the plan for an objective, its four read-only steps, an estimated cost of 1,150 credits, and Approve and Reject buttons." sizes="(max-width: 860px) 100vw, 560px" />
        </div>
        <figcaption>
          <b>Step 02 in the product.</b> The plan and its cost wait for your approval; nothing is charged until you approve.
        </figcaption>
      </figure>
      <figure className="st-shot">
        <div className="st-shot-frame">
          <Image src={verification} alt="The verification panel: an overall score and five checks — objective alignment, evidence support, success criteria coverage, completeness and internal consistency." sizes="(max-width: 860px) 100vw, 560px" />
        </div>
        <figcaption>
          <b>Step 04 in the product.</b> The verification gate shows each check before the result is called done.
        </figcaption>
      </figure>
      <p className="st-shots-note">Screenshots of the real interface from a test run on our test AI provider: the example objective, scores and wording are test data, not a customer result.</p>
    </div>
  );
}
