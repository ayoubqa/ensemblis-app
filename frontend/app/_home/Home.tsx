"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { LOOP } from "@/lib/data";
import { ROUTES } from "@/lib/routes";
import { TrialModal } from "./TrialModal";

const TEAM: { title: string; icon: IconName; caps: string[] }[] = [
  { title: "Head of Marketing", icon: "globe", caps: ["Market Research", "Competitor Analysis", "Customer / ICP Analysis", "Positioning Analysis"] },
  { title: "Head of Sales", icon: "zap", caps: ["Account Research", "Lead Research", "Sales Opportunity Analysis"] },
  { title: "Head of Finance", icon: "eur", caps: ["Financial Analysis", "Scenario Analysis", "Unit Economics"] },
  { title: "Head of Operations", icon: "settings", caps: ["Process Analysis", "Operational Research", "Workflow Analysis"] },
];

const TRUST: { icon: IconName; title: string; body: string }[] = [
  { icon: "check", title: "You approve before anything is spent", body: "Every plan comes with its cost. It runs only after your approval — or automatically within a budget you set." },
  { icon: "link", title: "Evidence behind every claim", body: "Sources, documents and your company context are numbered and cited. You can see what supports each conclusion." },
  { icon: "shield", title: "A real verification gate", body: "Claims are checked against the cited evidence, every success criterion is assessed, and results that fail are revised or escalated — never quietly passed." },
  { icon: "alert", title: "Exceptions, not guesses", body: "When information is missing or something fails, Ensemblis stops and tells you what happened, why it matters and what it needs." },
  { icon: "lock", title: "Read-only by design", body: "The AI Team researches, analyses, drafts and recommends. It never sends email, publishes, changes your systems or spends money on its own." },
  { icon: "eur", title: "Pay for work that runs", body: "Usage-based. Work that fails or never runs is refunded automatically, and your organization's data stays isolated." },
];

const EXAMPLE_PLAN: { who: string; what: string }[] = [
  { who: "Chief of Staff", what: "Frame the objective with your product, ICP and goals" },
  { who: "Head of Marketing → Market Research Analyst", what: "Research candidate markets: size, growth, regulation" },
  { who: "Head of Marketing → Competitive Intelligence Analyst", what: "Map competitors and openings per market" },
  { who: "Head of Finance → Financial Analyst", what: "Compare the economics of entry" },
  { who: "Chief of Staff → Synthesis Lead", what: "Recommend three markets against your success criteria" },
];

export function Home() {
  const { user } = useAuth();
  const { config } = useConfig();
  const [trial, setTrial] = useState(false);

  // /?trial=1 (linked from the login page) opens the no-account trial directly.
  useEffect(() => {
    if (config.guestTrialEnabled && !user && new URLSearchParams(window.location.search).get("trial") === "1") setTrial(true);
  }, [config.guestTrialEnabled, user]);

  return (
    <>
      <section className="hero-dk dk">
        <div className="wrap hx">
          <span className="hx-badge">
            <span className="pulse" aria-hidden="true" />
            The AI operating layer for business
          </span>
          <h1>Describe the outcome. We do the work.</h1>
          <p className="sub">
            Ensemblis turns a business objective into a plan, assigns it to an AI organization led by a Chief of Staff, executes it, verifies the result against evidence and tells you whether the objective was achieved.
          </p>
          <div className="row wrapflex" style={{ marginTop: 28, gap: 12 }}>
            {user ? (
              <>
                <Link href={ROUTES.newObjective} className="btn p lg">
                  Define an outcome
                  <Icon name="arrow" />
                </Link>
                <Link href={ROUTES.dashboard} className="btn lg">
                  Open your briefing
                </Link>
              </>
            ) : (
              <>
                <Link href={ROUTES.signup} className="btn p lg">
                  Get started
                  <Icon name="arrow" />
                </Link>
                {config.guestTrialEnabled && (
                  <button type="button" className="btn lg" onClick={() => setTrial(true)}>
                    Try without an account
                  </button>
                )}
              </>
            )}
          </div>

          <div className="card" style={{ marginTop: 44, maxWidth: 820 }} aria-label="Illustration: anatomy of an objective">
            <div className="row between wrapflex">
              <span className="eyebrow" style={{ margin: 0 }}>
                ILLUSTRATION · ANATOMY OF AN OBJECTIVE
              </span>
              <span className="tag gray">example, not a real run</span>
            </div>
            <p style={{ fontSize: 17, fontWeight: 600, marginTop: 10, lineHeight: 1.45 }}>
              “Analyze the European market for our product and recommend the three highest-potential markets for expansion.”
            </p>
            <div className="small muted" style={{ marginTop: 8 }}>
              Success looks like: <b style={{ color: "var(--ink)" }}>3 markets, ranked</b> · <b style={{ color: "var(--ink)" }}>every recommendation cites evidence</b> · <b style={{ color: "var(--ink)" }}>entry risks stated</b>
            </div>
            <ol className="feed" style={{ marginTop: 14 }}>
              {EXAMPLE_PLAN.map((s, i) => (
                <li key={s.what} style={{ gridTemplateColumns: "28px minmax(0,1fr)" }}>
                  <span className="mono muted">{i + 1}</span>
                  <div>
                    <span className="who">{s.who}</span>
                    <span>{s.what}</span>
                  </div>
                </li>
              ))}
              <li style={{ gridTemplateColumns: "28px minmax(0,1fr)" }}>
                <span className="mono muted">✓</span>
                <div>
                  <span className="who">Verification gate</span>
                  <span>Check claims against evidence and each success criterion, then measure the outcome</span>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <section className="sect" id="how" style={{ scrollMarginTop: 80 }}>
        <div className="wrap">
          <div className="eyebrow">HOW IT WORKS</div>
          <h2>Delegate a result, not a prompt.</h2>
          <p className="muted" style={{ maxWidth: "64ch" }}>
            You think in business outcomes. Ensemblis runs the loop that gets you there — and keeps you in control at the moments that matter.
          </p>
          <div className="loopbar" style={{ marginTop: 26 }}>
            {LOOP.map((s, i) => (
              <div className="lp" key={s.key}>
                <span className="k">
                  {i + 1}. {s.title}
                </span>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sect" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="eyebrow">YOUR AI ORGANIZATION</div>
          <h2>A Chief of Staff and four executives.</h2>
          <p className="muted" style={{ maxWidth: "64ch" }}>
            Not a collection of chatbots: an organization. The Chief of Staff plans and assigns; each executive owns a set of versioned capabilities, and a specialist runs each one with the tools its playbook allows.
          </p>
          <div className="orgtree" style={{ marginTop: 26 }}>
            <div className="orgroot">
              <div className="exec root">
                <div className="ttl">
                  <span className="exec-badge" style={{ width: 34, height: 34 }}>
                    <Icon name="compass" size={17} />
                  </span>
                  <div>
                    <h3>Chief of Staff</h3>
                    <div className="tiny muted">Objective planning · cross-functional synthesis</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="orgbranches">
              {TEAM.map((t) => (
                <div key={t.title}>
                  <div className="exec">
                    <div className="ttl">
                      <span className="exec-badge" style={{ width: 34, height: 34 }}>
                        <Icon name={t.icon} size={17} />
                      </span>
                      <h3>{t.title}</h3>
                    </div>
                    <ul className="small" style={{ paddingLeft: 18, marginTop: 10 }}>
                      {t.caps.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="sect" id="trust" style={{ paddingTop: 0, scrollMarginTop: 80 }}>
        <div className="wrap">
          <div className="eyebrow">CONTROL & TRUST</div>
          <h2>Autonomous where it&apos;s safe. Accountable everywhere.</h2>
          <div className="grid g3" style={{ marginTop: 24 }}>
            {TRUST.map((t) => (
              <div className="card" key={t.title}>
                <span className="exec-badge" style={{ width: 34, height: 34 }}>
                  <Icon name={t.icon} size={17} />
                </span>
                <h3 style={{ marginTop: 12 }}>{t.title}</h3>
                <p className="small muted">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band dk">
        <div className="wrap">
          <h2>What business result do you need next?</h2>
          <p className="muted" style={{ marginTop: 12, maxWidth: "56ch" }}>
            Tell Ensemblis about your company once. Then delegate outcomes — market entry, competitor landscapes, pipeline briefings, unit economics, process redesign — and get verified, evidenced results.
          </p>
          <div className="row wrapflex" style={{ marginTop: 22 }}>
            <Link href={user ? ROUTES.newObjective : ROUTES.signup} className="btn p lg">
              {user ? "Define an outcome" : "Get started"}
              <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>

      <TrialModal open={trial} onClose={() => setTrial(false)} />
    </>
  );
}
