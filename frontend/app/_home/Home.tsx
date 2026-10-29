// The Ensemblis homepage, rebuilt around the five questions a first-time visitor needs answered fast:
// what is it · what do I get · who is it for · why trust it · what do I do next. Server-rendered; only the
// session-dependent calls to action and the live beta facts are client islands. The deep product walkthrough
// lives on /how-it-works. Every claim is true of the product today (see content.ts and lib/offer.ts).
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PostItem } from "@/components/blog/Parts";
import { BetaFacts } from "@/components/site/BetaFacts";
import { ExecutionLedger } from "@/components/site/ExecutionLedger";
import { ReportAnatomy } from "@/components/site/ReportAnatomy";
import { ProductShots } from "@/components/site/ProductShots";
import { StartLink } from "@/components/site/StartLink";
import { UseCaseArt } from "@/components/site/UseCaseArt";
import type { Post } from "@/lib/blog/posts";
import { BLOG } from "@/lib/blog/seo";
import { PLAN_COST, TEAM_NAMES, USE_CASES, capabilitiesFor } from "@/lib/offer";
import { SITE } from "@/lib/site";
import { HeroNote } from "./Actions";
import { EXAMPLE, FAQ, TRUST, TRUST_PHASES } from "./content";

function Head({ id, kicker, title, lead, center = false }: { id: string; kicker: string; title: React.ReactNode; lead?: React.ReactNode; center?: boolean }) {
  return (
    <header className={center ? "st-head st-head-c" : "st-head"}>
      <p className="st-kicker">
        <span className="st-node" aria-hidden="true" />
        {kicker}
      </p>
      <h2 id={id}>{title}</h2>
      {lead && <p className="st-lead">{lead}</p>}
    </header>
  );
}

const HOW = [
  { n: "01", t: "Describe the outcome", b: "The result you need, how success will be judged, a deadline and a budget — in plain language." },
  { n: "02", t: "Approve the plan and its cost", b: "Each step has an owner and a price in credits. Nothing runs, and nothing is charged, until you approve — or pre-approve a budget." },
  { n: "03", t: "Watch the work happen", b: "Specialists research and analyse with read-only tools. Evidence is numbered as it is found; missing information comes back to you as a question." },
  { n: "04", t: "Get a verified result", b: "A verification gate checks the work before it is called done; each success criterion is measured; failed or unstarted work is refunded." },
];

export function Home({ latest = [] }: { latest?: Post[] }) {
  return (
    <div className="st">
      {/* 1 — What it is */}
      <section className="st-hero dk" aria-labelledby="st-h1">
        <div className="wrap st-hero-grid">
          <div className="st-hero-copy">
            <p className="st-kicker">
              <span className="st-node" aria-hidden="true" />
              AI research &amp; analysis for business
            </p>
            <h1 id="st-h1">
              Describe the outcome.
              <br />
              <em>We do the work.</em>
            </h1>
            <p className="st-sub">
              Ensemblis turns a business question into a decision-ready result. It plans the research and analysis, shows you the cost before anything
              runs, and checks every claim against cited evidence before calling it done.
            </p>
            <div className="st-ctas">
              <StartLink from="home-hero">
                Get started
                <Icon name="arrow" />
              </StartLink>
              <a href="#output" className="btn lg st-btn-quiet">
                See what you get
              </a>
            </div>
            <HeroNote />
            <ul className="st-proof" aria-label="How every objective runs">
              <li>Plan and cost before work runs</li>
              <li>Numbered, cited evidence</li>
              <li>Five-check verification gate</li>
              <li>Read-only by design</li>
            </ul>
          </div>
          <ExecutionLedger objective="Recommend the three highest-potential European markets for our expansion next year." criteria={EXAMPLE.criteria} />
        </div>
      </section>

      {/* 2 — What you get */}
      <section className="st-sec" id="output" aria-labelledby="st-output">
        <div className="wrap">
          <Head
            id="st-output"
            kicker="What you get"
            title="Not an answer to read. A result you can check."
            lead="Every objective ends in the same kind of document: it answers the question first, shows the evidence behind each claim, measures your success criteria and says what it could not establish."
          />
          <ReportAnatomy />
        </div>
      </section>

      {/* 3 — Who it's for / what you can hand off */}
      <section className="st-sec st-sec-alt" id="use-cases" aria-labelledby="st-uses">
        <div className="wrap">
          <Head
            id="st-uses"
            kicker="What you can hand off today"
            title="Research and analysis, across four teams."
            lead="Built for founders and small teams who need work they can check: questions answerable from the public web, your own documents and what you tell Ensemblis about your company."
          />
          <ul className="st-uses">
            {USE_CASES.map((u) => (
              <li key={u.id}>
                <UseCaseArt team={u.team} />
                <p className="st-uses-team">{TEAM_NAMES[u.team]}</p>
                <h3>
                  <Link href={`/use-cases#${u.id}`}>{u.title}</Link>
                </h3>
                <p className="st-uses-ex">&ldquo;{u.examples[0].objective}&rdquo;</p>
                <p className="st-uses-caps">{capabilitiesFor(u.team).map((c) => c.name).join(" · ")}</p>
              </li>
            ))}
          </ul>
          <p className="st-more">
            <Link href="/use-cases" className="st-textlink">
              Every use case, with example objectives and what each delivers →
            </Link>
          </p>
        </div>
      </section>

      {/* 4 — How it works */}
      <section className="st-sec" id="how" aria-labelledby="st-how">
        <div className="wrap">
          <Head id="st-how" kicker="How it works" title="You stay in control at the moments that matter." />
          <ol className="st-steps">
            {HOW.map((s) => (
              <li key={s.n}>
                <span className="st-steps-n">{s.n}</span>
                <h3>{s.t}</h3>
                <p>{s.b}</p>
              </li>
            ))}
          </ol>
          <ProductShots />
          <p className="st-more">
            <Link href="/how-it-works" className="st-textlink">
              The full walkthrough: plans, approvals, exceptions, verification and memory →
            </Link>
          </p>
        </div>
      </section>

      {/* 5 — Why trust it */}
      <section className="st-sec st-sec-alt" id="trust" aria-labelledby="st-trust">
        <div className="wrap">
          <Head
            id="st-trust"
            kicker="Control and trust"
            title="Built so you can rely on it — and see when you shouldn't."
            lead="AI-generated work can contain mistakes. Ensemblis is designed to make them visible: every important claim is grounded in evidence, checked, and measured against criteria you set."
          />
          <ol className="st-ctl">
            {TRUST_PHASES.map((ph) => (
              <li key={ph.key} className={`st-ctl-${ph.key}`}>
                <p className="st-ctl-k">
                  <span className="st-ctl-dot" aria-hidden="true" />
                  {ph.label}
                </p>
                <p className="st-ctl-sub">{ph.sub}</p>
                <ul className="st-trust">
                  {TRUST.filter((t) => t.phase === ph.key).map((t) => (
                    <li key={t.title}>
                      <Icon name={t.icon} size={18} />
                      <h3>{t.title}</h3>
                      <p>{t.body}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 6 — What it costs */}
      <section className="st-sec" id="pricing" aria-labelledby="st-price">
        <div className="wrap st-price">
          <div>
            <Head
              id="st-price"
              kicker="Pricing"
              title="Know the cost before anything runs."
              lead={
                <>
                  Work is priced step by step in credits. An objective uses <b>{PLAN_COST.min.toLocaleString("en-US")}–{PLAN_COST.max.toLocaleString("en-US")} credits</b>,
                  verification included, and you approve the total first.
                </>
              }
            />
            <p className="st-more">
              <Link href="/pricing" className="st-textlink">
                The full price list and how credits work →
              </Link>
            </p>
          </div>
          <div className="st-price-card">
            <p className="st-lg-k">Private beta</p>
            <BetaFacts />
          </div>
        </div>
      </section>

      {/* 7 — Fit */}
      <section className="st-sec st-sec-alt" aria-labelledby="st-fit">
        <div className="wrap">
          <Head id="st-fit" kicker="Is it right for you?" title="A good fit — and not yet a fit." />
          <div className="st-fit">
            <div>
              <h3>
                <Icon name="check" size={16} /> A good fit when
              </h3>
              <ul>
                <li>You need research or analysis you can show to someone else, with its sources.</li>
                <li>The answer can come from the public web, your own documents and what you know about your company.</li>
                <li>You want to approve the plan and the cost before work starts.</li>
                <li>A clear &ldquo;we couldn&apos;t establish this&rdquo; is more useful to you than a confident guess.</li>
              </ul>
            </div>
            <div>
              <h3>
                <Icon name="x" size={16} /> Not yet a fit when
              </h3>
              <ul>
                <li>You need actions taken in your systems: sending, publishing, buying. Ensemblis is read-only.</li>
                <li>The data lives in tools Ensemblis can&apos;t reach — it has no CRM or analytics integrations yet.</li>
                <li>You need legal, financial or medical advice.</li>
                <li>The result must be right without anyone reviewing it.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 8 — Journal (only once something is published) */}
      {latest.length > 0 && (
        <section className="st-sec" aria-labelledby="st-journal">
          <div className="wrap">
            <Head id="st-journal" kicker="From the Journal" title="Practical, sourced writing on AI, strategy and growth." />
            <div className="ed-list ed-list-3">
              {latest.map((p) => (
                <PostItem key={p.slug} post={p} />
              ))}
            </div>
            <p className="st-more">
              <Link href={BLOG.path} className="st-textlink">
                Read the Journal →
              </Link>
            </p>
          </div>
        </section>
      )}

      {/* 9 — Questions */}
      <section className="st-sec st-sec-alt" aria-labelledby="st-faq">
        <div className="wrap st-faq-grid">
          <div>
            <Head id="st-faq" kicker="Questions" title="Ensemblis, in plain terms." />
            <p className="st-def">{SITE.definition}</p>
          </div>
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

      {/* 10 — Next step */}
      <section className="st-final dk" aria-labelledby="st-final-h">
        <div className="wrap">
          <h2 id="st-final-h">What should your business stop researching by hand?</h2>
          <p className="st-lead">Describe it once. Approve the plan. Review a verified result with its evidence.</p>
          <div className="st-ctas st-ctas-c">
            <StartLink from="home-final">
              Get started
              <Icon name="arrow" />
            </StartLink>
            <Link href="/use-cases" className="btn lg st-btn-quiet">
              Explore use cases
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
