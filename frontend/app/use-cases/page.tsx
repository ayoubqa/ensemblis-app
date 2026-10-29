import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { Icon } from "@/components/Icon";
import { StartLink } from "@/components/site/StartLink";
import { UseCaseArt } from "@/components/site/UseCaseArt";
import { TEAM_NAMES, USE_CASES, capabilitiesFor } from "@/lib/offer";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/site";

const TITLE = "Use cases: market, competitor, sales, finance and operations research";
const DESCRIPTION =
  "What you can delegate to Ensemblis today: market and competitor research, ICP and positioning, account and lead research, financial scenarios and unit economics, process and vendor analysis — each with cited evidence and a verification report.";

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/use-cases" });

export default function UseCasesPage() {
  return (
    <div className="st">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Use cases", path: "/use-cases" }])} />
      <section className="st-page-head dk" aria-labelledby="uc-h1">
        <div className="wrap">
          <p className="st-kicker">
            <span className="st-node" aria-hidden="true" />
            Use cases
          </p>
          <h1 id="uc-h1">What you can hand off today.</h1>
          <p className="st-sub">
            Research and analysis across marketing, sales, finance and operations. Each objective is planned by a Chief of Staff, carried out by
            specialists with read-only tools, and verified before you see it.
          </p>
          <nav aria-label="Use cases on this page" className="st-jump">
            {USE_CASES.map((u) => (
              <a key={u.id} href={`#${u.id}`}>
                {TEAM_NAMES[u.team]}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {USE_CASES.map((u, i) => (
        <section key={u.id} id={u.id} className={`st-sec ${i % 2 ? "st-sec-alt" : ""}`} aria-labelledby={`uc-${u.id}`}>
          <div className="wrap st-uc">
            <header className="st-head">
              <p className="st-kicker">
                <span className="st-node" aria-hidden="true" />
                {TEAM_NAMES[u.team]}
              </p>
              <h2 id={`uc-${u.id}`}>{u.title}</h2>
              <p className="st-lead">{u.intro}</p>
              <p className="st-uc-for">
                <b>Usually asked by:</b> {u.for}
              </p>
              <UseCaseArt team={u.team} />
            </header>

            <div className="st-uc-body">
              <h3 className="st-mini-h">Example objectives</h3>
              <ul className="st-uc-ex">
                {u.examples.map((e) => (
                  <li key={e.objective}>
                    <p>&ldquo;{e.objective}&rdquo;</p>
                    <ul aria-label="Success criteria">
                      {e.criteria.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className="st-note">Examples of objectives and success criteria — not customer results.</p>

              <h3 className="st-mini-h">Capabilities and what each delivers</h3>
              <ul className="st-uc-caps">
                {capabilitiesFor(u.team).map((c) => (
                  <li key={c.key}>
                    <p className="st-uc-cap">
                      <b>{c.name}</b>
                      <span>{c.costCredits} credits</span>
                    </p>
                    <p>{c.description}</p>
                    <p className="st-uc-deliv">
                      <span>Delivers:</span> {c.deliverable.join(" · ")}
                      {c.web ? " · uses web research" : " · works from your documents and Company Context"}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ))}

      <section className="st-final dk" aria-labelledby="uc-final">
        <div className="wrap">
          <h2 id="uc-final">Not sure it fits your question?</h2>
          <p className="st-lead">
            Describe the outcome anyway: you&apos;ll see the plan and its cost before anything runs, and nothing is charged until you approve it.
          </p>
          <div className="st-ctas st-ctas-c">
            <StartLink from="use-cases-final">
              Get started
              <Icon name="arrow" />
            </StartLink>
            <Link href="/pricing" className="btn lg st-btn-quiet">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
