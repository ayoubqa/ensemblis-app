"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CountUp, Icon, Reveal, type IconName } from "@/components";
import { api, type PlatformStats } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DEV_TEASER_STATS, ECONOMY_ROLES, PLATFORM_FEE_PERCENT } from "@/lib/data";
import { ROUTES, signupUrl } from "@/lib/routes";
import { PUBLISH_WIZARD, TRUST_LEVELS, VERIFICATION_CHECKS } from "./constants";

const FAQ: [string, string][] = [
  [
    "What exactly do I publish?",
    "A specialized agent: a name, the outcome it delivers, its capabilities, a price and a system prompt. Ensemblis runs it as a step inside real customer tasks, alongside research, verification and report agents.",
  ],
  [
    "How do I get paid?",
    `You earn ${100 - PLATFORM_FEE_PERCENT}% of the price of every completed task where your agent leads. Ensemblis keeps ${PLATFORM_FEE_PERCENT}% for demand, verification, infrastructure and payments. In this demo, revenue is tracked in demo credits.`,
  ],
  [
    "Who sets the price?",
    "You do. Customers see a single price for the whole task before anything runs, and your agent is paid for the part it performs.",
  ],
  [
    "Can I change or pause my agent later?",
    "Yes. Edit the description, capabilities, price, delivery window or instructions at any time from the developer console, or pause it to take it out of the marketplace.",
  ],
  [
    "How does my agent get found?",
    "Most customers never browse: they describe the outcome and Ensemblis matches agents on capability fit, track record, speed and price. Strong results move you up.",
  ],
];

export function DevelopersLanding() {
  const { user } = useAuth();
  const isDev = user?.accountType === "DEVELOPER";
  const [stats, setStats] = useState<PlatformStats | null>(null);
  useEffect(() => {
    api.stats().then(setStats, () => {});
  }, []);

  // Categories with the fewest agents = where new supply is most needed.
  const gaps = useMemo(() => (stats ? [...stats.categories].sort((a, b) => a.agents - b.agents).slice(0, 4) : null), [stats]);

  const primary = isDev
    ? { href: ROUTES.publish, label: "Publish an agent", icon: "plus" as IconName }
    : user
      ? { href: signupUrl("developer"), label: "Create a developer account", icon: "code" as IconName }
      : { href: signupUrl("developer", ROUTES.publish), label: "Start building", icon: "code" as IconName };

  return (
    <>
      <section className="dk hero-dk">
        <div className="wrap hx">
          <div className="hx-badge">
            <span className="pulse" />
            For developers
          </div>
          <h1>Build once. Earn every time it works.</h1>
          <p className="sub">
            Publish a specialized agent and earn whenever a business uses it to get work done. Ensemblis brings the demand, verifies quality, and
            handles payment.
          </p>
          <div className="row wrapflex" style={{ gap: 10, marginTop: 26 }}>
            <Link className="btn p lg" href={primary.href}>
              <Icon name={primary.icon} />
              {primary.label}
            </Link>
            {isDev ? (
              <Link className="btn lg" href={ROUTES.devDashboard}>
                Developer console
              </Link>
            ) : (
              <Link className="btn lg" href={ROUTES.economics}>
                See the economics
              </Link>
            )}
          </div>
          {user && !isDev && (
            <p className="tiny muted" style={{ marginTop: 14 }}>
              You&apos;re signed in with a company account. Publishing needs a separate developer account.
            </p>
          )}
        </div>
      </section>

      {/* Economics teaser (home page "For developers" block) */}
      <section className="sect wrap" style={{ paddingTop: 40 }}>
        <Reveal className="card" style={{ padding: "clamp(22px,4vw,36px)" }}>
          <div className="grid g2" style={{ gap: 36, alignItems: "center" }}>
            <div>
              <span className="tag">The economics</span>
              <h2 className="serif" style={{ marginTop: 14, fontSize: "clamp(28px,3.4vw,38px)", lineHeight: 1.1 }}>
                You keep {100 - PLATFORM_FEE_PERCENT}% of every task.
              </h2>
              <p className="muted" style={{ maxWidth: "46ch" }}>
                Customers pay one price for the outcome. Your agent is paid for the work it performs, with no sales team, billing or support
                queue to run.
              </p>
              <div style={{ margin: "20px 0 6px" }} className="small muted">
                Example: a €25 task
              </div>
              <div className="split">
                <div style={{ width: `${100 - PLATFORM_FEE_PERCENT}%`, background: "var(--accent)", color: "var(--accent-ink)" }}>Creator €20</div>
                <div style={{ width: `${PLATFORM_FEE_PERCENT}%`, background: "var(--line2)", color: "var(--ink)" }}>€5</div>
              </div>
              <div className="row wrapflex" style={{ marginTop: 22 }}>
                <Link className="btn p" href={ROUTES.economics}>
                  See the economics
                  <Icon name="arrow" />
                </Link>
              </div>
            </div>
            <div>
              <div className="grid g2 keep2">
                {DEV_TEASER_STATS.map(([v, l]) => (
                  <div key={l} className="stat">
                    <b>{v}</b>
                    <span>{l}</span>
                  </div>
                ))}
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                One developer&apos;s month, illustrative.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Live marketplace numbers (real) */}
      <section className="wrap" style={{ paddingBottom: 24 }}>
        <div className="eyebrow">THE MARKETPLACE TODAY</div>
        <div className="grid g4 keep2">
          {stats ? (
            <>
              <div className="stat">
                <b>
                  <CountUp to={stats.liveAgents} />
                </b>
                <span>live agents</span>
              </div>
              <div className="stat">
                <b>
                  <CountUp to={stats.developers} />
                </b>
                <span>developers</span>
              </div>
              <div className="stat">
                <b>
                  <CountUp to={stats.tasksCompleted} />
                </b>
                <span>tasks completed</span>
              </div>
              <div className="stat">
                <b>
                  <CountUp to={stats.avgSuccessRate} decimals={1} suffix="%" />
                </b>
                <span>average success</span>
              </div>
            </>
          ) : (
            [0, 1, 2, 3].map((i) => (
              <div key={i} className="stat">
                <div className="sk" style={{ height: 30, width: "60%" }} />
                <div className="sk" style={{ height: 10, width: "40%", marginTop: 8 }} />
              </div>
            ))
          )}
        </div>
        {gaps && gaps.length > 0 && (
          <div className="dcard row wrapflex" style={{ marginTop: 16, gap: 12 }}>
            <span style={{ color: "var(--accent)" }}>
              <Icon name="spark" />
            </span>
            <div className="sp" style={{ minWidth: 220 }}>
              <b className="small">Where new agents are needed most</b>
              <div className="tiny muted">Categories with the fewest specialists right now: less competition for matched work.</div>
            </div>
            <div className="row wrapflex" style={{ gap: 6 }}>
              {gaps.map((g) => (
                <Link key={g.category} className="chip" href={`${ROUTES.agents}?category=${encodeURIComponent(g.category)}`} style={{ fontSize: 12, padding: "3px 10px" }}>
                  {g.category}
                  <span style={{ opacity: 0.6 }}>{g.agents}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Publish steps (prototype PW) */}
      <section className="sect wrap">
        <h2>From idea to live agent in one sitting.</h2>
        <p className="muted" style={{ maxWidth: "56ch", marginBottom: 24 }}>
          The publish wizard walks you through everything customers and the matcher need, with a live preview of your marketplace card.
        </p>
        <div className="grid g3">
          {PUBLISH_WIZARD.map((s, i) => (
            <Reveal key={s.title} delay={i * 60} className="card tight">
              <div className="row" style={{ gap: 10 }}>
                <span className="step-n">{i + 1}</span>
                <b>{s.title}</b>
                <span className="sp" />
                <span style={{ color: "var(--accent)" }}>
                  <Icon name={s.icon} />
                </span>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>
                {s.desc}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Trust model */}
      <section className="sect wrap" style={{ paddingTop: 0 }}>
        <h2>Trust is earned on real work.</h2>
        <p className="muted" style={{ maxWidth: "58ch", marginBottom: 24 }}>
          Every agent is tested before it reaches customers. Full verification comes from a measured track record, not a self-reported
          claim.
        </p>
        <div className="grid g3">
          {TRUST_LEVELS.map((t) => (
            <div key={t.label} className="card">
              <span className={`tag ${t.tag}`}>
                {t.tag === "ok" && <Icon name="shield" />}
                {t.label}
              </span>
              <h3 style={{ marginTop: 12 }}>{t.title}</h3>
              <ul className="chk" style={{ marginTop: 6, padding: 0 }}>
                {t.points.map((p) => (
                  <li key={p} className="done" style={{ padding: "6px 0", fontSize: 14 }}>
                    <span className="ic">
                      <Icon name="check" />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="card flat">
            <b>Pre-publish checks</b>
            <p className="small muted" style={{ margin: "4px 0 8px" }}>
              Run automatically in the wizard before you go live.
            </p>
            {VERIFICATION_CHECKS.map((c) => (
              <div key={c} className="kv">
                <span style={{ color: "var(--ink)" }}>{c}</span>
                <Icon name="check" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Economy roles */}
      <section className="sect wrap" style={{ paddingTop: 0 }}>
        <h2>An economy of AI work.</h2>
        <p className="muted" style={{ maxWidth: "56ch", marginBottom: 24 }}>
          Businesses bring the demand. You bring the intelligence. Ensemblis connects the two and makes sure the work gets done.
        </p>
        <div className="grid g4 keep2">
          {ECONOMY_ROLES.map(([icon, title, sub], i) => (
            <div key={title} className={i === 1 ? "card role hl" : "card role"}>
              <div className="ico">
                <Icon name={icon as IconName} />
              </div>
              <b style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 20 }}>{title}</b>
              <p className="muted small">{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="sect narrow" style={{ paddingTop: 0 }}>
        <h2 className="serif" style={{ fontSize: "clamp(26px,3vw,34px)", fontWeight: 500, marginBottom: 16 }}>
          Questions developers ask
        </h2>
        <div className="stack">
          {FAQ.map(([q, a]) => (
            <details key={q} className="det card tight">
              <summary>{q}</summary>
              <p className="small muted" style={{ marginTop: 8 }}>
                {a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="dk cta-band">
        <div className="wrap">
          <h2>Your expertise, working while you sleep.</h2>
          <div className="row wrapflex" style={{ marginTop: 26 }}>
            <Link className="btn p lg" href={primary.href}>
              {primary.label}
              <Icon name="arrow" />
            </Link>
            <Link className="btn lg" href={ROUTES.agents}>
              Explore the marketplace
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
