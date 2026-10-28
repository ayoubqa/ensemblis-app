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
        <div className="wrap st-page-head-grid">
          <div>
            <p className="st-kicker">
              <span className="st-node" aria-hidden="true" />
              Get access
            </p>
            <h1 id="ac-h1">Start with a real question.</h1>
            <p className="st-sub">
              Ensemblis is in a private beta. Bring a business question you would otherwise research by hand: you&apos;ll see the plan and its cost
              before anything runs.
            </p>
            <h2 className="st-mini-h st-mini-h-dk">What the beta includes</h2>
            <ul className="st-beta">
              <li>Every capability: market, competitor, customer, account, financial, process and vendor research and analysis.</li>
              <li>
                Objectives cost {PLAN_COST.min.toLocaleString("en-US")}–{PLAN_COST.max.toLocaleString("en-US")} credits each, shown before you approve.
              </li>
            </ul>
            <BetaFacts />
            <p className="st-access-more">
              Not sure yet? Read <Link href="/use-cases">what you can hand off</Link>, <Link href="/how-it-works">how it works</Link> or{" "}
              <Link href="/pricing">how pricing works</Link>.
            </p>
          </div>
          <AccessPanel />
        </div>
      </section>
    </div>
  );
}
