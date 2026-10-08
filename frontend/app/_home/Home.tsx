// The Ensemblis landing page: one story, eleven sections, dark navy for the
// story and light surfaces for reading. Server-rendered; only the calls to
// action are client islands (they depend on the session). Section ids
// "how" and "trust" are linked from the header, footer and command palette.
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Briefing, ContextLayer, EvidenceLayer, ExecutionTrace, Lifecycle, OperatingLayer, OrgChart, ToolSprawl, ToolsToOutcome } from "@/components/marketing/Visuals";
import { EXAMPLE_OBJECTIVES } from "@/lib/data";
import { SITE } from "@/lib/site";
import { FinalActions, HeroActions } from "./Actions";
import { ANSWER_VS_OUTCOME, CONTEXT_FIELDS, FAQ, MANUAL_WORK, MEMORY_KINDS, STORY, TRUST } from "./content";

function SectionHead({ id, eyebrow, title, lead, center = false }: { id?: string; eyebrow: string; title: React.ReactNode; lead?: React.ReactNode; center?: boolean }) {
  return (
    <header className={center ? "mk-head mk-head-center" : "mk-head"}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {lead && <p className="mk-lead">{lead}</p>}
    </header>
  );
}

export function Home() {
  return (
    <div className="mk">
      {/* 1 — Hero */}
      <section className="mk-hero dk" aria-labelledby="mk-h1">
        <div className="mk-hero-bg" aria-hidden="true" />
        <div className="wrap mk-hero-grid">
          <div className="mk-hero-copy">
            <p className="eyebrow">{SITE.positioning.replace(/\.$/, "")}</p>
            <h1 id="mk-h1">
              Describe the outcome. <span className="mk-grad">We do the work.</span>
            </h1>
            <p className="mk-sub">{SITE.supporting}</p>
            <HeroActions />
            <ul className="mk-assure" aria-label="Built in">
              <li>
                <Icon name="check" size={14} />
                You approve before work starts
              </li>
              <li>
                <Icon name="shield" size={14} />
                Every result verified against evidence
              </li>
              <li>
                <Icon name="lock" size={14} />
                Read-only by design
              </li>
            </ul>
          </div>
          <OperatingLayer />
        </div>
      </section>

      {/* 2 — The problem */}
      <section className="mk-sec lt" aria-labelledby="mk-problem">
        <div className="wrap mk-split">
          <div>
            <SectionHead
              id="mk-problem"
              eyebrow="The problem"
              title="More software. Still more work."
              lead="Businesses have more tools than ever — CRM, project management, spreadsheets, analytics, communication, knowledge bases. Yet people still spend hours on the work between them:"
            />
            <ul className="mk-ticks">
              {MANUAL_WORK.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="mk-punch">
              The problem isn&apos;t a lack of software. <b>It&apos;s the gap between having tools and getting the work done.</b>
            </p>
          </div>
          <ToolSprawl />
        </div>
      </section>

      {/* 3 — The shift */}
      <section className="mk-sec dk mk-glow" aria-labelledby="mk-shift">
        <div className="wrap">
          <SectionHead
            id="mk-shift"
            eyebrow="The shift"
            title="From tools to outcomes."
            lead="Traditional software asks people to operate tools. Ensemblis starts with the business outcome — and works back to the plan, the work and the proof."
          />
          <ToolsToOutcome />
          <div className="mk-versus">
            <div>
              <span className="mk-k">Operating tools</span>
              <p>You open the apps, gather the data, do the analysis, write it up and hope it&apos;s right.</p>
            </div>
            <div className="on">
              <span className="mk-k">Describing outcomes</span>
              <p>You state the result and how it will be judged, approve the plan, and review a verified outcome with its evidence.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 4 — How Ensemblis works */}
      <section className="mk-sec lt" id="how" aria-labelledby="mk-how">
        <div className="wrap">
          <SectionHead
            id="mk-how"
            eyebrow="How Ensemblis works"
            title="From objective to verified outcome."
            lead="One operating loop for every objective — with you in control at the moments that matter."
          />
          <Lifecycle />
          <p className="mk-more">
            <Link href="/how-it-works" className="mk-textlink">
              Read the full walkthrough: plans, approvals, exceptions, verification and memory <Icon name="chev" size={14} />
            </Link>
          </p>
        </div>
      </section>

      {/* 5 — Chief of Staff */}
      <section className="mk-sec dk" aria-labelledby="mk-cos">
        <div className="wrap mk-split mk-split-rev">
          <div>
            <SectionHead
              id="mk-cos"
              eyebrow="Chief of Staff"
              title="One objective. One operating layer."
              lead="The Chief of Staff understands the objective, your company context, your constraints and your success criteria — then coordinates the work required to achieve the outcome."
            />
            <ul className="mk-points">
              <li>
                <b>Frames the objective</b> with what it knows about your company.
              </li>
              <li>
                <b>Builds a short plan</b>, assigns every step to an owner and estimates the cost.
              </li>
              <li>
                <b>Asks instead of guessing</b> when information the result depends on is missing.
              </li>
              <li>
                <b>Synthesises the work</b> into one recommendation against your criteria.
              </li>
            </ul>
          </div>
          <Briefing />
        </div>
      </section>

      {/* 6 — AI Team */}
      <section className="mk-sec lt" aria-labelledby="mk-team">
        <div className="wrap">
          <SectionHead
            id="mk-team"
            eyebrow="AI Team"
            title="An AI organization built around your business."
            lead="Not a collection of chatbots — an organization. The Chief of Staff plans and assigns. Each executive owns a set of capabilities, and specialists carry them out using only the tools they are allowed."
          />
          <OrgChart />
        </div>
      </section>

      {/* 7 — Execution */}
      <section className="mk-sec dk mk-glow" aria-labelledby="mk-exec">
        <div className="wrap mk-split">
          <div>
            <SectionHead
              id="mk-exec"
              eyebrow="Execution"
              title="From plan to execution."
              lead="Every objective moves through the same accountable lifecycle. You can watch each step as it happens, and the record stays — even if you close the tab."
            />
            <ul className="mk-points">
              <li>
                <b>Live progress</b> for every step, rebuilt from a persistent activity log.
              </li>
              <li>
                <b>Approvals and exceptions</b> bring a decision to you only when one is needed.
              </li>
              <li>
                <b>Recovery built in</b> — work interrupted mid-step resumes, and work that never started is refunded.
              </li>
            </ul>
          </div>
          <ExecutionTrace />
        </div>
      </section>

      {/* 8 — Trust / verification */}
      <section className="mk-sec lt" id="trust" aria-labelledby="mk-trust">
        <div className="wrap">
          <SectionHead
            id="mk-trust"
            eyebrow="Verification & evidence"
            title="AI that shows its work."
            lead="Ensemblis doesn't just generate text. Every important result is grounded in evidence, checked by a verification gate and measured against the success criteria you set."
          />
          <EvidenceLayer />
          <ul className="mk-trust">
            {TRUST.map((t) => (
              <li key={t.title}>
                <span className="mk-ico" aria-hidden="true">
                  <Icon name={t.icon} size={17} />
                </span>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 9 — Company Context */}
      <section className="mk-sec dk" aria-labelledby="mk-ctx">
        <div className="wrap mk-split">
          <div>
            <SectionHead
              id="mk-ctx"
              eyebrow="Company Context"
              title="AI that understands your business."
              lead="Tell Ensemblis about your company once. Every plan and every step works from the same context — so the work is about your business, not an average one."
            />
            <ul className="mk-points">
              <li>
                <b>Company profile</b>: what you do, products, business model, customers, markets and goals.
              </li>
              <li>
                <b>Website and documents</b> become evidence the AI Team can cite.
              </li>
              <li>
                <b>Organizational memory</b> keeps preferences, decisions and lessons from one objective to the next — you can edit or remove any of it.
              </li>
            </ul>
          </div>
          <ContextLayer fields={CONTEXT_FIELDS} memory={MEMORY_KINDS} />
        </div>
      </section>

      {/* 10 — Outcomes */}
      <section className="mk-sec lt" aria-labelledby="mk-outcomes">
        <div className="wrap">
          <SectionHead
            id="mk-outcomes"
            eyebrow="Outcomes"
            title={
              <>
                The output isn&apos;t an answer.
                <br />
                It&apos;s an outcome.
              </>
            }
            lead="An AI response gives you something to read. Ensemblis gives you completed business work you can check, decide on and build on."
          />
          <div className="mk-compare" role="table" aria-label="An AI response compared with an Ensemblis outcome">
            <div className="mk-compare-row mk-compare-head" role="row">
              <span role="columnheader">An AI response</span>
              <span role="columnheader">An Ensemblis outcome</span>
            </div>
            {ANSWER_VS_OUTCOME.map((r) => (
              <div className="mk-compare-row" role="row" key={r.answer}>
                <span role="cell">
                  <Icon name="x" size={14} />
                  {r.answer}
                </span>
                <span role="cell">
                  <Icon name="check" size={14} />
                  {r.outcome}
                </span>
              </div>
            ))}
          </div>
          <h3 className="mk-subhead">Objectives you can delegate</h3>
          <ul className="mk-examples">
            {EXAMPLE_OBJECTIVES.map((e) => (
              <li key={e.label}>
                <span className="mk-k">{e.label}</span>
                <p>{e.statement}</p>
                <ul>
                  {e.criteria.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mk-note">Examples of objectives and success criteria — not customer results.</p>
        </div>
      </section>

      {/* GEO: direct, self-contained answers */}
      <section className="mk-sec lt mk-faq-sec" aria-labelledby="mk-faq">
        <div className="wrap mk-faq-grid">
          <div>
            <SectionHead id="mk-faq" eyebrow="Questions" title="Ensemblis, in plain terms." />
            <p className="mk-def">{SITE.definition}</p>
            <p className="mk-flow" aria-label="The Ensemblis lifecycle">
              {STORY.map((s, i) => (
                <span key={s.key}>
                  {s.title}
                  {i < STORY.length - 1 && <Icon name="chev" size={12} />}
                </span>
              ))}
            </p>
          </div>
          <div className="mk-faq">
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

      {/* 11 — Final CTA */}
      <section className="mk-final dk" aria-labelledby="mk-final">
        <div className="mk-hero-bg" aria-hidden="true" />
        <div className="wrap">
          <h2 id="mk-final">What outcome should your business stop doing manually?</h2>
          <p className="mk-lead">Describe it once. Ensemblis plans it, executes it, verifies it — and shows you the evidence.</p>
          <FinalActions />
        </div>
      </section>
    </div>
  );
}
