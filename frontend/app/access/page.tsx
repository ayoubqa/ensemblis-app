import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { BetaFacts } from "@/components/site/BetaFacts";
import { PLAN_COST } from "@/lib/offer";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/site";
import { AccessPanel } from "./AccessPanel";

export const metadata = pageMetadata({
  title: "Get access",
  description: "Ensemblis is in a private beta. Request access, or sign up with your invite code — and see what the beta includes.",
  path: "/access",
});

export default function AccessPage() {
  return (
    <div className="st">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Get access", path: "/access" }])} />
      <section className="st-page-head dk" aria-labelledby="ac-h1">
        {/* Intro, then the action, then the details: on a phone the request form comes before the fine print. */}
        <div className="wrap st-page-head-grid st-access-grid">
          <div className="st-access-intro">
            <p className="st-kicker">
              <span className="st-node" aria-hidden="true" />
              Get access
            </p>
            <h1 id="ac-h1">Start with a real question.</h1>
            <p className="st-sub">
              Ensemblis is in a private beta. Bring a business question you would otherwise research by hand: you&apos;ll see the plan and its cost
              before anything runs.
            </p>
          </div>
          <div className="st-access-panel">
            <AccessPanel />
          </div>
          <div className="st-access-details">
            <h2 className="st-mini-h st-mini-h-dk">What the beta includes</h2>
            <ul className="st-beta">
              <li>Every capability: market, competitor, customer, account, financial, process and vendor research and analysis.</li>
              <li>
                Objectives cost {PLAN_COST.min.toLocaleString("en-US")}–{PLAN_COST.max.toLocaleString("en-US")} credits each, shown before you approve.
              </li>
            </ul>
            <h2 className="st-mini-h st-mini-h-dk">What happens after you sign up</h2>
            <ol className="st-after">
              <li>
                <b>Tell it about your company</b> — a short form it uses as context. Optional: you can skip it and add it later.
              </li>
              <li>
                <b>Define your first outcome</b>: the question, and how you&apos;ll judge the answer. It suggests success criteria you can edit.
              </li>
              <li>
                <b>See the plan and its cost</b> in credits. Nothing runs, and nothing is charged, until you approve.
              </li>
              <li>
                <b>Get a verified report</b>: findings with numbered sources, and a check of each success criterion.
              </li>
            </ol>
            <BetaFacts />
            <p className="st-access-more">
              Not sure yet? Read <Link href="/use-cases">what you can hand off</Link>, <Link href="/how-it-works">how it works</Link> or{" "}
              <Link href="/pricing">how pricing works</Link>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
