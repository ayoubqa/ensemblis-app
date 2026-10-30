// The Ensemblis homepage: "the working paper" (docs/design/direction.md). It answers, in order, what a
// business visitor needs before taking a next step: what it is, how a request becomes a result, what comes
// back, what it is for, when to use something else, what it costs and how access works, then the questions a
// careful buyer asks. Server-rendered; only the session-dependent calls to action and the live beta facts are
// client islands. Every claim is true of the product today (see content.ts and lib/offer.ts).
import Image from "next/image";
import Link from "next/link";
import { PostItem } from "@/components/blog/Parts";
import { BetaFacts } from "@/components/site/BetaFacts";
import { StartLink } from "@/components/site/StartLink";
import type { Post } from "@/lib/blog/posts";
import { BLOG } from "@/lib/blog/seo";
import { PLAN_COST, TEAM_NAMES, USE_CASES } from "@/lib/offer";
import { ROUTES } from "@/lib/routes";
import { SITE } from "@/lib/site";
import approval from "@/public/site/product/approval-card.png";
import verification from "@/public/site/product/verification-gate.png";
import { HeroNote } from "./Actions";
import { Brief } from "./Brief";
import { CHOOSE, FAQ } from "./content";

/** The real sequence every objective runs. `you` marks the steps a person takes. */
const STEPS: { title: string; body: string; you?: string }[] = [
  { title: "Describe the outcome", body: "The result you need, how success will be judged, a deadline and a budget, in plain language.", you: "Your input" },
  { title: "Ensemblis plans it", body: "A Chief of Staff frames the objective with your company context, splits it into steps with an owner each, and prices every step." },
  { title: "Approve the plan and its cost", body: "Nothing runs and nothing is charged until you approve, or until a budget you set in advance allows it.", you: "You decide" },
  { title: "The AI team does the work", body: "Specialists research and analyse with read-only tools. Sources are numbered as they are found; missing information comes back to you as a question." },
  { title: "Verification checks it", body: "Five checks run before anything is called done, and each success criterion is measured. Work that fails or never starts is refunded." },
  { title: "Review the brief and judge it", body: "Read the answer with its evidence and limits, then accept or reject the outcome. Export it, or share a read-only link.", you: "You decide" },
];

/** What every brief contains: the sections the synthesis step must produce (backend registry). */
const PARTS: { title: string; body: string }[] = [
  { title: "The answer first", body: "An executive summary that answers the objective, then the findings and a recommendation." },
  { title: "Evidence for every claim", body: "Numbered citations to web sources, your documents or your company context. Inference is labelled as inference." },
  { title: "Your criteria, measured", body: "Each success criterion you set is marked met, partially met or not met." },
  { title: "A verification report", body: "Objective alignment, evidence support, criteria coverage, completeness and internal consistency, each shown." },
  { title: "Limits, stated", body: "What the evidence does not cover and what a person should confirm before acting." },
];

const NOT_FOR = [
  "You need a quick answer or a first draft, and being wrong costs little: a general AI assistant is faster.",
  "You need actions taken in your systems, such as sending, publishing or buying. Ensemblis is read-only.",
  "The data lives in tools Ensemblis can't reach yet, such as your CRM or analytics.",
  "You need legal, financial or medical advice, or a result nobody will review.",
];

function SectionHead({ id, title, lead }: { id: string; title: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <div className="wp-head">
      <h2 id={id}>{title}</h2>
      {lead && <p className="wp-lead">{lead}</p>}
    </div>
  );
}

export function Home({ latest = [] }: { latest?: Post[] }) {
  return (
    <div className="wp">
      <section className="wp-hero dk" aria-labelledby="wp-h1">
        <div className="wrap wp-hero-grid">
          <div className="wp-hero-copy">
            <h1 id="wp-h1">Describe the outcome. We do the work.</h1>
            <p className="wp-sub">
              {SITE.definition} Today that means business research and analysis: you approve the plan and its cost first, and every claim in the
              result is tied to its source.
            </p>
            <div className="wp-ctas">
              <StartLink from="home-hero">Get started</StartLink>
              <a href="#how" className="btn lg wp-quiet">
                See how it works
              </a>
            </div>
            <HeroNote />
          </div>
          <Brief />
        </div>
      </section>

      <section className="wp-sec wp-sec-first" id="how" aria-labelledby="wp-how">
        <div className="wrap">
          <SectionHead id="wp-how" title="How a request becomes a result" lead="Ensemblis does the work in between. You set the objective, approve the cost and judge the result." />
          <ol className="wp-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className={s.you ? "you" : undefined}>
                <span className="wp-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3>
                    {s.title}
                    {s.you && <span className="wp-you">{s.you}</span>}
                  </h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="wp-shots">
            <figure>
              <div className="wp-shot-frame">
                <Image src={approval} alt="An approval card: the plan for an objective, its read-only steps, the estimated cost in credits, and Approve and Reject buttons." sizes="(max-width: 860px) 100vw, 580px" />
              </div>
              <figcaption>Step 3 in the product: the plan and its cost wait for you.</figcaption>
            </figure>
            <figure>
              <div className="wp-shot-frame">
                <Image src={verification} alt="The verification panel: an overall score and five checks, from objective alignment to internal consistency." sizes="(max-width: 860px) 100vw, 580px" />
              </div>
              <figcaption>Step 5: every verification check is shown before the result is called done.</figcaption>
            </figure>
          </div>
          <p className="wp-note">Screenshots of the real interface from a local test run on a test AI provider. The objective and scores are test data.</p>
          <p className="wp-more">
            <Link href={ROUTES.howItWorksPage}>The full product walkthrough</Link>
          </p>
        </div>
      </section>

      <section className="wp-sec wp-sec-paper" id="output" aria-labelledby="wp-output">
        <div className="wrap wp-split">
          <SectionHead
            id="wp-output"
            title="A brief you can check, not an answer to trust"
            lead="Every objective ends in the same kind of document, built for someone who has to act on it or defend it."
          />
          <dl className="wp-parts">
            {PARTS.map((p) => (
              <div key={p.title}>
                <dt>{p.title}</dt>
                <dd>{p.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="wp-sec" id="use-cases" aria-labelledby="wp-uses">
        <div className="wrap">
          <SectionHead
            id="wp-uses"
            title="What you can hand off today"
            lead="Questions that can be answered from public sources, your own documents and what you tell Ensemblis about your company."
          />
          <ul className="wp-uses">
            {USE_CASES.map((u) => (
              <li key={u.id}>
                <p className="wp-uses-team">{TEAM_NAMES[u.team]}</p>
                <div className="wp-uses-main">
                  <h3>
                    <Link href={`${ROUTES.useCases}#${u.id}`}>{u.title}</Link>
                  </h3>
                  <p>{u.intro}</p>
                </div>
                <blockquote className="wp-uses-ex">
                  <p>{u.examples[0].objective}</p>
                  <footer>Example objective</footer>
                </blockquote>
              </li>
            ))}
          </ul>
          <p className="wp-more">
            <Link href={ROUTES.useCases}>Every use case, with example objectives</Link>
          </p>
        </div>
      </section>

      <section className="wp-sec wp-sec-paper" id="fit" aria-labelledby="wp-fit">
        <div className="wrap">
          <SectionHead id="wp-fit" title="Is it the right tool for the job?" lead="Ensemblis takes longer than a chat and uses credits, because it plans, sources and checks the work." />
          <div className="wp-fit">
            <div>
              <h3>Use Ensemblis when</h3>
              <ul>
                {CHOOSE.ensemblis.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Use something else when</h3>
              <ul>
                {NOT_FOR.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="wp-sec" id="pricing" aria-labelledby="wp-price">
        <div className="wrap wp-split">
          <SectionHead
            id="wp-price"
            title="Know the cost before anything runs"
            lead={
              <>
                Every step is priced in credits and the plan shows the total before you approve it. An objective uses {PLAN_COST.min.toLocaleString("en-US")} to{" "}
                {PLAN_COST.max.toLocaleString("en-US")} credits, verification included.
              </>
            }
          />
          <div className="wp-access">
            <h3>Access during the private beta</h3>
            <BetaFacts />
            <p className="wp-more">
              <Link href={ROUTES.pricing}>Pricing and how credits work</Link>
            </p>
          </div>
        </div>
      </section>

      {latest.length > 0 && (
        <section className="wp-sec wp-sec-paper" aria-labelledby="wp-blog">
          <div className="wrap">
            <SectionHead id="wp-blog" title="From the blog" />
            <div className="ed-list ed-list-3">
              {latest.map((p) => (
                <PostItem key={p.slug} post={p} />
              ))}
            </div>
            <p className="wp-more">
              <Link href={BLOG.path}>Read the blog</Link>
            </p>
          </div>
        </section>
      )}

      <section className={latest.length > 0 ? "wp-sec" : "wp-sec wp-sec-paper"} id="questions" aria-labelledby="wp-faq">
        <div className="wrap wp-split">
          <SectionHead id="wp-faq" title="Questions a careful buyer asks" lead="Plain answers, including what Ensemblis does not do yet." />
          <div className="wp-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  <h3>{f.q}</h3>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="wp-final dk" aria-labelledby="wp-final-h">
        <div className="wrap">
          <h2 id="wp-final-h">Bring one decision you need to make.</h2>
          <p>Describe it once, approve the plan and its cost, and review a brief that shows its evidence.</p>
          <div className="wp-ctas">
            <StartLink from="home-final">Get started</StartLink>
            <Link href={ROUTES.useCases} className="btn lg wp-quiet">
              Explore use cases
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
