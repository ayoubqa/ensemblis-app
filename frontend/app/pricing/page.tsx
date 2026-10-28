import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { Icon } from "@/components/Icon";
import { BetaFacts } from "@/components/site/BetaFacts";
import { ExecutionLedger } from "@/components/site/ExecutionLedger";
import { StartLink } from "@/components/site/StartLink";
import { EXAMPLE } from "@/app/_home/content";
import { CAPABILITIES, EXAMPLE_PLAN, EXAMPLE_PLAN_TOTAL, PLAN_COST, STEP_PRICES, TEAM_NAMES, VERIFICATION_CREDITS, WORK_STEPS, type Team } from "@/lib/offer";
import { breadcrumbJsonLd, faqJsonLd, pageMetadata } from "@/lib/site";

const TITLE = "Pricing";
const DESCRIPTION = `How Ensemblis is priced: every step has a fixed price in credits, you approve the total before anything runs, and failed work is refunded. An objective uses ${PLAN_COST.min}–${PLAN_COST.max} credits.`;

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/pricing" });

const FAQ = [
  {
    q: "Do I pay anything during the beta?",
    a: "No. Payments are switched off during the private beta: every account starts with free credits, and there is no card to enter.",
  },
  {
    q: "Why credits instead of a monthly price?",
    a: "Because the cost of a piece of work depends on what it needs. A three-step objective costs less than a seven-step one, and you see the exact total before you approve it.",
  },
  {
    q: "What happens if a step fails?",
    a: "Work that fails or never starts is refunded automatically, and an objective cancelled before it runs costs nothing. Ensemblis raises an exception rather than guessing when information is missing.",
  },
  {
    q: "Can I limit what Ensemblis spends?",
    a: "Yes. Each objective has a budget; plans arrive for your approval with their cost. You can allow automatic starts only within a budget and an approval threshold you set for your organization.",
  },
];

const TEAMS: Team[] = ["chief_of_staff", "marketing", "sales", "finance", "operations"];

export default function PricingPage() {
  return (
    <div className="st">
      <JsonLd data={[breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }]), faqJsonLd(FAQ)]} />
      <section className="st-page-head dk" aria-labelledby="pr-h1">
        <div className="wrap st-page-head-grid">
          <div>
            <p className="st-kicker">
              <span className="st-node" aria-hidden="true" />
              Pricing
            </p>
            <h1 id="pr-h1">Know the cost before anything runs.</h1>
            <p className="st-sub">
              Every step of the work has a fixed price in credits. Each plan shows its total for your approval, and work that fails or never starts is
              refunded automatically.
            </p>
            <div className="st-ctas">
              <StartLink from="pricing-hero">
                Get started
                <Icon name="arrow" />
              </StartLink>
            </div>
          </div>
          <div className="st-price-card st-price-card-hero">
            <p className="st-lg-k">Private beta</p>
            <BetaFacts />
          </div>
        </div>
      </section>

      <section className="st-sec" aria-labelledby="pr-how">
        <div className="wrap st-price-rules">
          <header className="st-head">
            <p className="st-kicker">
              <span className="st-node" aria-hidden="true" />
              How credits work
            </p>
            <h2 id="pr-how">
              {PLAN_COST.min.toLocaleString("en-US")}–{PLAN_COST.max.toLocaleString("en-US")} credits per objective.
            </h2>
            <p className="st-lead">
              A plan has one planning step, {WORK_STEPS.min} to {WORK_STEPS.max} research or analysis steps, and one synthesis step, followed by the
              verification gate. The planner sizes it to the objective; you see the plan and its total before approving.
            </p>
          </header>
          <ol className="st-steps st-steps-3">
            <li>
              <span className="st-steps-n">01</span>
              <h3>Priced per step</h3>
              <p>
                Planning costs {STEP_PRICES.planning} credits, research and analysis steps {STEP_PRICES.work.min}–{STEP_PRICES.work.max}, synthesis{" "}
                {STEP_PRICES.synthesis}. Verification is {VERIFICATION_CREDITS} per objective.
              </p>
            </li>
            <li>
              <span className="st-steps-n">02</span>
              <h3>Approved before it runs</h3>
              <p>Nothing is charged until you approve the plan — or until it starts within a budget you pre-approved.</p>
            </li>
            <li>
              <span className="st-steps-n">03</span>
              <h3>Refunded when it fails</h3>
              <p>A step that fails, or work that never starts, is refunded automatically. Cancelling before work starts costs nothing.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="st-sec st-sec-alt" aria-labelledby="pr-example">
        <div className="wrap st-split">
          <header className="st-head">
            <p className="st-kicker">
              <span className="st-node" aria-hidden="true" />
              A worked example
            </p>
            <h2 id="pr-example">
              A {EXAMPLE_PLAN.length}-step plan: {EXAMPLE_PLAN_TOTAL.toLocaleString("en-US")} credits.
            </h2>
            <p className="st-lead">
              Market research, competitor analysis and a financial view, framed by planning and brought together in a synthesis, then verified. Each
              line shows the step&apos;s owner and its price from the list below.
            </p>
          </header>
          <ExecutionLedger objective="Recommend the three highest-potential European markets for our expansion next year." criteria={EXAMPLE.criteria} />
        </div>
      </section>

      <section className="st-sec" aria-labelledby="pr-list">
        <div className="wrap">
          <header className="st-head">
            <p className="st-kicker">
              <span className="st-node" aria-hidden="true" />
              Price list
            </p>
            <h2 id="pr-list">Every capability, and what it costs.</h2>
            <p className="st-lead">
              Prices per step, in credits. The same list the planner uses to estimate every plan.
            </p>
          </header>
          <div className="ed-table st-pricelist" role="region" aria-label="Price list" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  <th scope="col">Owner</th>
                  <th scope="col">What it does</th>
                  <th scope="col" className="num">
                    Credits
                  </th>
                </tr>
              </thead>
              <tbody>
                {TEAMS.flatMap((t) =>
                  CAPABILITIES.filter((c) => c.team === t).map((c) => (
                    <tr key={c.key}>
                      <th scope="row">{c.name}</th>
                      <td>{TEAM_NAMES[c.team]}</td>
                      <td>{c.description}</td>
                      <td className="num">{c.costCredits}</td>
                    </tr>
                  ))
                )}
                <tr>
                  <th scope="row">Verification gate</th>
                  <td>Verifier</td>
                  <td>Checks objective alignment, evidence support, success-criteria coverage, completeness and internal consistency — once per objective.</td>
                  <td className="num">{VERIFICATION_CREDITS}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="st-sec st-sec-alt" aria-labelledby="pr-faq">
        <div className="wrap st-faq-grid">
          <header className="st-head">
            <p className="st-kicker">
              <span className="st-node" aria-hidden="true" />
              Questions
            </p>
            <h2 id="pr-faq">About cost and credits.</h2>
            <p className="st-lead">
              More on approvals and refunds in <Link href="/how-it-works#usage">How it works</Link>; the rules for beta credits are in the{" "}
              <Link href="/terms">Terms</Link>.
            </p>
          </header>
          <div className="st-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  <h3>{f.q}</h3>
                  <Icon name="plus" size={16} />
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
