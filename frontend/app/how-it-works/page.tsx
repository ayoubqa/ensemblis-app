// /how-it-works — the authoritative, public explanation of how Ensemblis works.
// Written for people evaluating Ensemblis and for search / answer engines:
// self-contained definitions, one H1, a logical H2/H3 outline, truthful JSON-LD.
// Every statement describes behaviour that exists in the product today.
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { JsonLd } from "@/components/JsonLd";
import { CHIEF_OF_STAFF, CONTEXT_FIELDS, DEPARTMENTS, MEMORY_KINDS, STORY, VERIFICATION_CHECKS } from "@/app/_home/content";
import { FinalActions } from "@/app/_home/Actions";
import { SITE, breadcrumbJsonLd, pageMetadata, webPageJsonLd } from "@/lib/site";

const TITLE = "How Ensemblis works";
const DESCRIPTION =
  "How Ensemblis turns a business objective into planned, executed and verified work: the Chief of Staff, approvals and exceptions, the AI Team, the verification gate, evidence, outcome measurement, Company Context and memory.";

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/how-it-works" });

const TOC = [
  ["what", "What Ensemblis is"],
  ["lifecycle", "The lifecycle"],
  ["objective", "Defining an objective"],
  ["planning", "Planning and the Chief of Staff"],
  ["control", "Approvals and exceptions"],
  ["team", "The AI Team"],
  ["execution", "Execution"],
  ["verification", "Verification and evidence"],
  ["outcome", "Outcome measurement"],
  ["context", "Company Context and memory"],
  ["sharing", "Reports and sharing"],
  ["limits", "What Ensemblis doesn't do"],
  ["usage", "Usage and refunds"],
] as const;

export default function HowItWorksPage() {
  return (
    <div className="mk">
      <JsonLd
        data={[
          webPageJsonLd({ path: "/how-it-works", name: `${TITLE} · ${SITE.name}`, description: DESCRIPTION }),
          breadcrumbJsonLd([
            { name: SITE.name, path: "/" },
            { name: TITLE, path: "/how-it-works" },
          ]),
        ]}
      />
      <section className="mk-doc-hero dk" aria-labelledby="hiw-h1">
        <div className="mk-hero-bg" aria-hidden="true" />
        <div className="wrap" style={{ position: "relative" }}>
          <nav className="mk-crumbs" aria-label="Breadcrumb">
            <Link href="/">Ensemblis</Link>
            <Icon name="chev" size={12} />
            <span aria-current="page">How it works</span>
          </nav>
          <p className="eyebrow">Product walkthrough</p>
          <h1 id="hiw-h1">How Ensemblis works</h1>
          <p className="mk-sub">{SITE.definition} This page explains each part of that loop — and where you stay in control.</p>
        </div>
      </section>

      <section className="mk-sec lt">
        <div className="wrap mk-doc">
          <nav className="mk-toc" aria-label="On this page">
            {TOC.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>

          <div className="mk-doc-body">
            <section id="what" aria-labelledby="h-what">
              <h2 id="h-what">What Ensemblis is</h2>
              <p>
                <strong>Ensemblis is an AI operating layer for business.</strong> It sits between business intent and execution: you describe the outcome you need, and
                Ensemblis coordinates AI-powered planning, execution, verification and evidence around it.
              </p>
              <p>
                It is designed for businesses that want AI to execute operational and knowledge work — research, analysis and recommendations — rather than simply
                provide conversational answers. Traditional AI assistants primarily generate responses; Ensemblis is built around business outcomes, so every
                objective ends with a result that has been checked against evidence and measured against the success criteria you set.
              </p>
            </section>

            <section id="lifecycle" aria-labelledby="h-lifecycle">
              <h2 id="h-lifecycle">The lifecycle</h2>
              <p>Every objective moves through the same ten stages. Each one is recorded, so you can see what happened and why.</p>
              <ol className="mk-steps10">
                {STORY.map((s, i) => (
                  <li key={s.key}>
                    <span className="n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div>
                      <b>{s.title}</b>
                      <span>{s.body}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section id="objective" aria-labelledby="h-objective">
              <h2 id="h-objective">Defining an objective</h2>
              <p>
                An <strong>objective</strong> is the business result you want, written in plain language — for example, “Recommend the three highest-potential European
                markets for our product.” Alongside it you set:
              </p>
              <ul className="mk-bullets">
                <li>
                  <strong>Success criteria</strong> — how the result will be judged (“3 markets, ranked”, “every recommendation cites evidence”). Ensemblis can suggest
                  criteria; you decide.
                </li>
                <li>
                  <strong>A deadline and a budget</strong> — the most you are willing to spend on this objective.
                </li>
                <li>
                  <strong>Context notes</strong> — anything specific to this objective that isn&apos;t in your Company Context.
                </li>
                <li>
                  <strong>Autonomy</strong> — review every plan before it starts, or let it start automatically when the estimate is within your budget and your
                  organization&apos;s approval threshold.
                </li>
              </ul>
            </section>

            <section id="planning" aria-labelledby="h-planning">
              <h2 id="h-planning">Planning and the Chief of Staff</h2>
              <p>
                The <strong>Chief of Staff</strong> is the coordination layer. It reads the objective, your success criteria, your Company Context and relevant memory,
                then writes a short plan: each step names the executive and capability responsible for it, what it should produce, and an estimated cost for the whole
                plan.
              </p>
              <p>
                If the result depends on information it doesn&apos;t have, the Chief of Staff <strong>stops and asks</strong> instead of guessing. You answer — or tell it to
                proceed with stated assumptions — and planning resumes.
              </p>
            </section>

            <section id="control" aria-labelledby="h-control">
              <h2 id="h-control">Approvals and exceptions</h2>
              <h3>Approvals</h3>
              <p>
                An <strong>approval</strong> is a decision Ensemblis needs from you before spending anything: typically the plan and its estimated cost. Nothing is
                executed or charged before you approve — unless you chose automatic starts within a budget. Rejecting a plan cancels it at no cost.
              </p>
              <h3>Exceptions</h3>
              <p>
                An <strong>exception</strong> is raised when something needs a person: missing information, a step that failed after its retries, a balance or daily limit
                that blocks the start, or a result that didn&apos;t pass verification. Each exception says what happened, why it matters, what Ensemblis recommends and
                what it needs from you — then you retry, answer, accept or cancel.
              </p>
            </section>

            <section id="team" aria-labelledby="h-team">
              <h2 id="h-team">The AI Team</h2>
              <p>
                The <strong>AI Team</strong> is an organization, not a collection of chatbots. The {CHIEF_OF_STAFF.title} plans and synthesises; four executives each own a
                set of <strong>capabilities</strong>, and a specialist carries out each capability using only the tools that capability is allowed.
              </p>
              <div className="tw mk-table">
                <table>
                  <caption className="sr-only">Executives and their capabilities</caption>
                  <thead>
                    <tr>
                      <th scope="col">Executive</th>
                      <th scope="col">Capabilities</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <b>{CHIEF_OF_STAFF.title}</b>
                      </td>
                      <td>{CHIEF_OF_STAFF.capabilities.join(" · ")}</td>
                    </tr>
                    {DEPARTMENTS.map((d) => (
                      <tr key={d.key}>
                        <td>
                          <b>{d.title}</b>
                        </td>
                        <td>{d.capabilities.join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="execution" aria-labelledby="h-execution">
              <h2 id="h-execution">Execution</h2>
              <p>
                Once a plan is approved, the specialists work through its steps in order. They research and analyse with <strong>read-only tools</strong> — web research,
                your documents, your Company Context and calculations — and every source they use becomes numbered <strong>evidence</strong>.
              </p>
              <p>
                You can watch each step as it happens. Progress is rebuilt from a persistent activity log, so refreshing the page or closing the tab loses nothing.
                Transient failures are retried automatically; a step interrupted mid-way resumes; and if a step can&apos;t be completed, Ensemblis raises an exception
                rather than continuing on a broken foundation.
              </p>
            </section>

            <section id="verification" aria-labelledby="h-verification">
              <h2 id="h-verification">Verification and evidence</h2>
              <p>Before any result is called complete, it passes a <strong>verification gate</strong>. The gate checks:</p>
              <ul className="mk-bullets">
                {VERIFICATION_CHECKS.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p>
                Claims are compared with the evidence they cite, and each success criterion is assessed. A result that doesn&apos;t pass is revised once automatically; if
                it still falls short, Ensemblis escalates it to you with the details, and you decide whether to accept it, retry with guidance or cancel. Nothing that
                failed verification is presented as verified.
              </p>
            </section>

            <section id="outcome" aria-labelledby="h-outcome">
              <h2 id="h-outcome">Outcome measurement</h2>
              <p>
                An <strong>outcome</strong> is the measured result of an objective. Each success criterion is marked <strong>met</strong>, <strong>partially met</strong> or{" "}
                <strong>not met</strong> — or not measured when it can&apos;t be judged from the work — and the objective as a whole is recorded as achieved, partially
                achieved or not achieved. You can confirm or correct that judgement yourself.
              </p>
            </section>

            <section id="context" aria-labelledby="h-context">
              <h2 id="h-context">Company Context and memory</h2>
              <p>
                <strong>Company Context</strong> is what Ensemblis knows about your business, entered once and used by every objective: {CONTEXT_FIELDS.slice(0, 6).join(", ").toLowerCase()}, your website and your
                documents (PDF, Word, Excel, CSV and text). Documents are treated as data — never as instructions to the AI.
              </p>
              <p>
                <strong>Memory</strong> holds what your organization wants Ensemblis to keep in mind — {MEMORY_KINDS.join(", ").toLowerCase()}. After an execution, Ensemblis
                proposes learnings; low-risk ones are kept, anything sensitive waits for a person, and you can edit or remove any memory at any time.
              </p>
              <div className="mk-callout">
                Each organization&apos;s objectives, Company Context, documents and memory are isolated from every other organization.
              </div>
            </section>

            <section id="sharing" aria-labelledby="h-sharing">
              <h2 id="h-sharing">Reports and sharing</h2>
              <p>
                A completed outcome is a <strong>report</strong>: the result with its citations, the evidence list, the verification checks and the measurement of each
                success criterion. You can export it as PDF, Word or Markdown, or share a read-only link — which never shows prices or account details, and stops
                working the moment you turn sharing off.
              </p>
            </section>

            <section id="limits" aria-labelledby="h-limits">
              <h2 id="h-limits">What Ensemblis doesn&apos;t do</h2>
              <p>
                The AI Team is <strong>read-only by design</strong>. It researches, analyses, drafts and recommends. It never sends email, publishes content, changes
                records in your systems or spends money on its own.
              </p>
              <p>
                AI-generated work can contain mistakes. That is why every result arrives with its evidence and its verification report — review them before you act.
              </p>
            </section>

            <section id="usage" aria-labelledby="h-usage">
              <h2 id="h-usage">Usage and refunds</h2>
              <p>
                Ensemblis is usage-based. Each plan shows its <strong>estimated cost</strong> before anything starts, and the estimate is drawn from your
                organization&apos;s balance only when execution begins. Work that fails or never starts is <strong>refunded automatically</strong>, and every charge
                and refund is listed on your Usage page. Daily limits protect against runaway use.
              </p>
            </section>
          </div>
        </div>
      </section>

      <section className="mk-final dk" aria-labelledby="hiw-final">
        <div className="mk-hero-bg" aria-hidden="true" />
        <div className="wrap">
          <h2 id="hiw-final">Ready to delegate an outcome?</h2>
          <p className="mk-lead">Describe it once. Ensemblis plans it, executes it, verifies it — and shows you the evidence.</p>
          <FinalActions secondary={{ href: "/", label: "Back to the overview" }} />
        </div>
      </section>
    </div>
  );
}
