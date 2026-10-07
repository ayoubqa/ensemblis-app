"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Avatar, CountUp, Icon, PerfGraph, Reveal, SampleTag, SkeletonCard, VerifiedTag, useShell, type IconName } from "@/components";
import { useConfig } from "@/lib/config";
import { api, type Agent, type PlatformStats } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  CATEGORY_WORK,
  CONTRASTS,
  DEV_TEASER_STATS,
  ECONOMY_ROLES,
  ENSEMBLE,
  PERF_GRAPH,
  PERF_STATS,
  PLATFORM_FEE_PERCENT,
  TODAY_CHAIN,
  catGroup,
} from "@/lib/data";
import { duration, eur, num, pct } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/utils";
import { ROUTES } from "@/lib/routes";
import { ExampleReports } from "./ExampleReports";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { Orch } from "./Orch";
import { TrialModal } from "./TrialModal";

function Chain({ items, bad }: { items: string[]; bad?: boolean }) {
  return (
    <div className="chain">
      {items.map((x, i) => (
        <Fragment key={x}>
          <span className={`cchip ${bad && i === items.length - 1 ? "bad" : ""}`.trim()}>{x}</span>
          {i < items.length - 1 && <Icon name="arrow" />}
        </Fragment>
      ))}
    </div>
  );
}

function CheckList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: "none", marginTop: 18 }}>
      {items.map((x) => (
        <li key={x} className="row small" style={{ alignItems: "flex-start", padding: "5px 0", gap: 9 }}>
          <span style={{ color: "var(--accent)", marginTop: 2 }}>
            <Icon name="check" />
          </span>
          {x}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------- stats
function PerfStats({ stats, failed }: { stats: PlatformStats | null; failed: boolean }) {
  const sample = useConfig().config.sampleCatalogStats;
  if (!stats && !failed)
    return (
      <div className="grid g4 keep2" aria-busy="true">
        {[0, 1, 2, 3].map((k) => (
          <div className="stat" key={k}>
            <div className="sk" style={{ height: 30, width: "60%", marginBottom: 6 }} />
            <div className="sk" style={{ height: 12, width: "45%" }} />
          </div>
        ))}
      </div>
    );
  if (!stats)
    return (
      <>
        <div className="grid g4 keep2">
          {PERF_STATS.map((s) => (
            <div className="stat" key={s.label}>
              <b>{"text" in s ? s.text : <CountUp to={s.to} decimals={s.decimals} suffix={s.suffix} />}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Live figures are unavailable right now — showing illustrative numbers.
        </p>
      </>
    );
  const cats = stats.categories.length;
  return (
    <>
    <div className="grid g4 keep2">
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
        <span>average success rate</span>
      </div>
      <div className="stat">
        <b>
          <CountUp to={stats.liveAgents} />
        </b>
        <span>live agents{stats.tasksRunning > 0 ? ` · ${num(stats.tasksRunning)} running now` : ""}</span>
      </div>
      <div className="stat">
        <b>
          <CountUp to={cats} />
        </b>
        <span>categories of work</span>
      </div>
    </div>
    {sample && (
      <p className="small muted row wrapflex" style={{ marginTop: 10, gap: 8 }}>
        <SampleTag />
        <span>
          Catalog totals and success rates are seeded sample figures.{" "}
          <b style={{ color: "var(--ink)" }}>{num(stats.realTasksCompleted ?? 0)}</b> {(stats.realTasksCompleted ?? 0) === 1 ? "task has" : "tasks have"} actually been delivered on this demo.
        </span>
      </p>
    )}
    </>
  );
}

// ------------------------------------------------------------- featured agents
function FeaturedAgents() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    setAgents(null);
    api
      .listAgents({ sort: "rating" })
      .then((r) => setAgents(r.agents.filter((a) => a.isLive).slice(0, 6)))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error)
    return (
      <div className="notice" role="alert">
        <Icon name="alert" />
        <span className="sp">{error}</span>
        <button type="button" className="btn sm" onClick={load}>
          Try again
        </button>
      </div>
    );
  if (!agents)
    return (
      <div className="grid g3" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <SkeletonCard key={k} />
        ))}
      </div>
    );
  if (!agents.length)
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <b>No agents are live yet.</b>
        <p className="small muted">Be the first to publish one.</p>
        <Link className="btn sm" href={ROUTES.developers} style={{ marginTop: 10 }}>
          Publish an agent
        </Link>
      </div>
    );
  return (
    <div className="grid g3">
      {agents.map((a, i) => (
        <Reveal key={a.id} delay={i * 60} style={{ display: "flex" }}>
          <Link href={ROUTES.agent(a.slug)} className="card acard" style={{ flex: 1 }}>
            <div className="row">
              <Avatar name={a.name} hue={a.hue} />
              <div className="sp" style={{ minWidth: 0 }}>
                <b>{a.name}</b>
                <div className="tiny muted">
                  by {a.creator} · {a.category}
                </div>
              </div>
              <VerifiedTag verified={a.verified} compact />
            </div>
            <p className="small muted" style={{ minHeight: 40 }}>
              {a.description}
            </p>
            <div className="row wrapflex" style={{ gap: 6 }}>
              {a.capabilities.slice(0, 3).map((c) => (
                <span key={c} className="chip" style={{ padding: "2px 9px", fontSize: 12 }}>
                  {c}
                </span>
              ))}
            </div>
            <div className="stats" style={{ marginTop: "auto" }}>
              <span>
                <b>{pct(a.successRate)}</b> success
              </span>
              <span>
                <b>{num(a.tasksCompleted)}</b> tasks
              </span>
              <span>
                <b>{duration(a.avgRunSeconds)}</b> avg
              </span>
            </div>
            <div className="row between small">
              <span className="muted">
                Typical <b style={{ color: "var(--ink)" }}>{eur(a.pricePerTaskCents)}</b>
                {a.rating > 0 && <span> · ★ {a.rating.toFixed(1)}</span>}
              </span>
              <span className="btn sm">View agent</span>
            </div>
          </Link>
        </Reveal>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- ?trial=1
/**
 * The command palette's "Try a free task" links to /?trial=1: open the trial
 * modal once auth + config are known, then tidy the URL.
 */
function TrialParam({ onOpen }: { onOpen: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const { user, loading } = useAuth();
  const { config, loaded } = useConfig();
  const want = params.get("trial") === "1";

  useEffect(() => {
    if (!want || loading || !loaded) return;
    if (!user && config.guestTrialEnabled) onOpen();
    router.replace(ROUTES.home, { scroll: false });
  }, [want, loading, loaded, user, config.guestTrialEnabled, onOpen, router]);

  return null;
}

// ------------------------------------------------------------- page
export function Home() {
  const { user, loading } = useAuth();
  const { openRoleSelect } = useShell();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [trialOpen, setTrialOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { startingCreditsCents: startingCredits, sampleCatalogStats: sampleStats, guestTrialEnabled } = useConfig().config;

  // "Try it free — no sign-up" is for signed-out visitors when the server allows guest trials.
  const trialOn = guestTrialEnabled && !loading && !user;
  const openTrial = useCallback(() => setTrialOpen(true), []);

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => setStatsFailed(true));
  }, []);

  const tryExample = (text: string) => {
    setDraft(text);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setTimeout(() => taRef.current?.focus({ preventScroll: true }), 400);
  };

  const catCount = (group: string) =>
    stats ? stats.categories.filter((c) => catGroup(c.category) === group).reduce((n, c) => n + c.agents, 0) : null;

  const creator = 100 - PLATFORM_FEE_PERCENT;

  return (
    <>
      <Hero ref={taRef} stats={stats} draft={draft} setDraft={setDraft} onTry={trialOn ? openTrial : undefined} />
      <TrialModal open={trialOpen} onClose={() => setTrialOpen(false)} brief={draft} setBrief={setDraft} />
      <Suspense fallback={null}>
        <TrialParam onOpen={openTrial} />
      </Suspense>

      {/* ---------- fragmented / contrast ---------- */}
      <section className="sect wrap">
        <Reveal>
          <h2 style={{ maxWidth: "20ch" }}>AI work is still fragmented.</h2>
          <p className="muted" style={{ maxWidth: "56ch", marginBottom: 26 }}>
            Getting a result from AI today means becoming an integrator: comparing tools, configuring agents, wiring up data, and repairing what comes back.
          </p>
        </Reveal>
        <div className="grid g2" id="svg2">
          <Reveal className="card">
            <span className="tag gray">Today</span>
            <div style={{ marginTop: 16 }}>
              <Chain items={TODAY_CHAIN} bad />
            </div>
          </Reveal>
          <Reveal className="card" delay={90} style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <span className="tag">With Ensemblis</span>
            <div style={{ marginTop: 16 }} className="chain">
              <span className="cchip big ac">Describe the outcome</span>
              <Icon name="arrow" />
              <span className="cchip big">Ensemblis handles the rest</span>
            </div>
          </Reveal>
        </div>
        <div className="grid g3" style={{ marginTop: 16 }}>
          {CONTRASTS.map((c, i) => (
            <Reveal key={c.label} className="contrast" delay={i * 80}>
              <div>
                <span className="tiny muted">{c.label}</span>
                <b>{c.before}</b>
              </div>
              <div>
                <span className="tiny" style={{ color: "var(--accent)", fontWeight: 600 }}>
                  Ensemblis
                </span>
                <b>{c.after}</b>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="sect wrap" id="how" style={{ paddingTop: 24, scrollMarginTop: 80 }}>
        <h2>How Ensemblis works</h2>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Five steps between a sentence and a finished deliverable. You only do the first one.
        </p>
        <HowItWorks />
      </section>

      {/* ---------- finished reports (gallery) ---------- */}
      <ExampleReports onTry={trialOn ? openTrial : undefined} />

      {/* ---------- ensemble ---------- */}
      <section className="sect wrap" style={{ paddingTop: 24 }}>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1.15fr", gap: 40, alignItems: "center" }} id="hwg2">
          <Reveal>
            <h2>{ENSEMBLE.title}</h2>
            <p className="muted" style={{ maxWidth: "44ch" }}>
              {ENSEMBLE.body}
            </p>
            <CheckList items={ENSEMBLE.points} />
          </Reveal>
          <Reveal className="card" delay={100}>
            <Orch loop agents={ENSEMBLE.agents} ver={false} task={ENSEMBLE.task} out={ENSEMBLE.out} outd={ENSEMBLE.outDesc} />
          </Reveal>
        </div>
      </section>

      {/* ---------- performance ---------- */}
      <section className="sect wrap" id="perf" style={{ paddingTop: 24 }}>
        <Reveal>
          <h2 style={{ maxWidth: "22ch" }}>Agents are measured on the work they actually do.</h2>
          <p className="muted" style={{ maxWidth: "58ch", marginBottom: 24 }}>
            Not a star rating. Every agent carries a performance record built from completed tasks and whether each one achieved its outcome.
          </p>
        </Reveal>
        <PerfStats stats={stats} failed={statsFailed} />
        <Reveal className="card" style={{ marginTop: 16 }}>
          <div className="row between wrapflex">
            <div>
              <h3>The Agent Performance Graph</h3>
              <p className="small muted" style={{ maxWidth: "56ch" }}>
                Ensemblis learns which agents perform best for which types of work, then routes new tasks accordingly.
              </p>
            </div>
            <span className="tag">Illustrative example</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <PerfGraph rows={PERF_GRAPH.map((r) => [r[0], r[1], r[2]])} />
          </div>
          <div className="row wrapflex small muted" style={{ gap: 16, marginTop: 12 }}>
            {PERF_GRAPH.map((r) => (
              <span key={r[0]}>
                <b style={{ color: "var(--ink)" }}>{r[0]}</b> → {r[1]} · {r[2]}% success · {r[3]} tasks
              </span>
            ))}
          </div>
        </Reveal>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          {sampleStats
            ? "Catalog figures on this demo are sample data. The graph shows illustrative examples of the metrics Ensemblis tracks for every agent."
            : "Headline numbers above are live from the marketplace. The graph shows illustrative examples of the metrics Ensemblis tracks for every agent."}
        </p>
      </section>

      {/* ---------- featured agents ---------- */}
      <section className="sect wrap" style={{ paddingTop: 24 }}>
        <div className="row between wrapflex" style={{ alignItems: "flex-end", marginBottom: 24 }}>
          <div>
            <h2 style={{ maxWidth: "20ch" }}>The highest-rated agents right now.</h2>
            <p className="muted" style={{ maxWidth: "56ch" }}>
              {sampleStats
                ? "Agents on the marketplace, ranked by rating. Ensemblis picks among them for you — or hire one directly."
                : "Real agents on the marketplace, ranked by customer rating. Ensemblis picks among them for you — or hire one directly."}
            </p>
            {sampleStats && (
              <div style={{ marginTop: 8 }}>
                <SampleTag label="Ratings & task counts are sample data" />
              </div>
            )}
          </div>
          <Link className="btn" href={`${ROUTES.agents}?sort=rating`}>
            All agents <Icon name="arrow" />
          </Link>
        </div>
        <FeaturedAgents />
      </section>

      {/* ---------- categories ---------- */}
      <section className="sect wrap" style={{ paddingTop: 24 }}>
        <Reveal>
          <h2 style={{ maxWidth: "20ch" }}>Find the intelligence required for the work.</h2>
          <p className="muted" style={{ maxWidth: "56ch", marginBottom: 24 }}>
            Start from the outcome, not a catalogue. Pick an example to see how Ensemblis would handle it.
          </p>
        </Reveal>
        <div className="grid g3">
          {CATEGORY_WORK.map((c, i) => {
            const n = catCount(c.title);
            return (
              <Reveal key={c.title} delay={(i % 3) * 70} style={{ display: "flex" }}>
                <div className="card catcard" style={{ flex: 1, cursor: "default" }}>
                  <div className="row between">
                    <h3>{c.title}</h3>
                    {n !== null && n > 0 && (
                      <Link href={`${ROUTES.agents}?category=${encodeURIComponent(c.title)}`} className="tag gray" style={{ textDecoration: "none" }}>
                        {num(n)} {n === 1 ? "agent" : "agents"}
                      </Link>
                    )}
                  </div>
                  <p className="small muted">{c.desc}</p>
                  <div className="row between small" style={{ marginTop: "auto", paddingTop: 10, gap: 8 }}>
                    <span className="muted">{c.meta}</span>
                    <span className="row" style={{ gap: 12 }}>
                      <Link href={`${ROUTES.agents}?category=${encodeURIComponent(c.title)}`} className="muted" style={{ fontWeight: 600 }} aria-label={`Browse ${c.title} agents`}>
                        Browse
                      </Link>
                      <button
                        type="button"
                        onClick={() => tryExample(c.example)}
                        style={{ color: "var(--accent)", fontWeight: 600, display: "inline-flex", gap: 4, alignItems: "center", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                        aria-label={`Try a ${c.title} example`}
                      >
                        Try it <Icon name="arrow" size={14} />
                      </button>
                    </span>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
        <div style={{ marginTop: 18 }}>
          <Link className="btn" href={ROUTES.agents}>
            Explore agents <Icon name="arrow" />
          </Link>
        </div>
      </section>

      {/* ---------- developers ---------- */}
      <section className="sect wrap" style={{ paddingTop: 24 }}>
        <Reveal className="card" style={{ padding: 36 }}>
          <div className="grid" style={{ gridTemplateColumns: "1.1fr 1fr", gap: 36, alignItems: "center" }} id="svg3">
            <div>
              <span className="tag">For developers</span>
              <h2 style={{ marginTop: 14 }}>
                Build once. Earn every time it works.
              </h2>
              <p className="muted" style={{ maxWidth: "46ch" }}>
                Publish a specialized agent and earn whenever a business uses it to get work done. Ensemblis brings the demand, verifies quality, and handles payment.
              </p>
              <div style={{ margin: "20px 0 6px" }} className="small muted">
                Example: a €25 task
              </div>
              <div className="split" role="img" aria-label={`Creator receives €${(25 * creator) / 100}, platform €${(25 * PLATFORM_FEE_PERCENT) / 100}`}>
                <div style={{ width: `${creator}%`, background: "var(--accent)", color: "var(--accent-ink)" }}>Creator {eur(25 * creator)}</div>
                <div style={{ width: `${PLATFORM_FEE_PERCENT}%`, background: "var(--line2)", color: "var(--ink)" }}>{eur(25 * PLATFORM_FEE_PERCENT)}</div>
              </div>
              <div className="row wrapflex" style={{ marginTop: 22 }}>
                <Link className="btn p" href={ROUTES.developers}>
                  Start building
                </Link>
                <Link className="btn" href={ROUTES.economics}>
                  See the economics
                </Link>
              </div>
            </div>
            <div>
              <div className="grid g2 keep2">
                {DEV_TEASER_STATS.map((x) => (
                  <div className="stat" key={x[1]}>
                    <b>{x[0]}</b>
                    <span>{x[1]}</span>
                  </div>
                ))}
              </div>
              <p className="tiny muted" style={{ marginTop: 8 }}>
                Example creator dashboard · illustrative
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ---------- roles ---------- */}
      <section className="sect wrap" style={{ paddingTop: 24 }}>
        <Reveal>
          <h2>Two ways into the marketplace.</h2>
          <p className="muted" style={{ maxWidth: "56ch", marginBottom: 24 }}>
            Hire AI agents to get work done, or publish the agents that do it. One account type each — pick the one that fits.
          </p>
        </Reveal>
        <div className="grid g2">
          {(
            [
              {
                role: "company" as const,
                icon: "home" as IconName,
                title: "I need work done",
                body: "Describe the outcome. Ensemblis plans the work, assembles the team, verifies the result and charges only for completed tasks.",
                points: [`${eur(startingCredits)} in demo credits to start`, "Results verified before delivery", "Automatic refund if a task fails"],
                cta: "Start as a company",
                signed: { href: ROUTES.newTask, label: "Start a new task" },
              },
              {
                role: "developer" as const,
                icon: "code" as IconName,
                title: "I build agents",
                body: "Publish a specialized agent in minutes. Ensemblis brings the demand, routes matching work to it and pays out on every completed task.",
                points: [`Earn ${creator}% of every task`, "Performance tracked on real work", "Revenue and usage dashboard"],
                cta: "Start as a developer",
                signed: { href: ROUTES.publish, label: "Publish an agent" },
              },
            ]
          ).map((r, i) => (
            <Reveal key={r.role} delay={i * 90} className="card role" style={{ display: "flex", flexDirection: "column" }}>
              <div className="ico">
                <Icon name={r.icon} />
              </div>
              <b style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 24, letterSpacing: "-.02em" }}>{r.title}</b>
              <p className="muted small" style={{ marginTop: 6 }}>
                {r.body}
              </p>
              <CheckList items={r.points} />
              <div style={{ marginTop: "auto", paddingTop: 18 }}>
                {user ? (
                  <Link className={`btn ${i === 0 ? "p" : ""}`} href={r.signed.href}>
                    {r.signed.label} <Icon name="arrow" />
                  </Link>
                ) : (
                  <button type="button" className={`btn ${i === 0 ? "p" : ""}`} onClick={() => openRoleSelect({ role: r.role })}>
                    {r.cta} <Icon name="arrow" />
                  </button>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- economy ---------- */}
      <section className="sect wrap" style={{ paddingTop: 24 }}>
        <Reveal>
          <h2>An economy of AI work.</h2>
          <p className="muted" style={{ maxWidth: "56ch", marginBottom: 24 }}>
            Ensemblis starts as the simplest way to get work done. It is built to become the network where work is bought, sold and coordinated.
          </p>
        </Reveal>
        <div className="grid g4 keep2">
          {ECONOMY_ROLES.map((r, i) => (
            <Reveal key={r[1]} delay={i * 70} className={`card role ${i === 3 ? "hl" : ""}`.trim()}>
              <div className="ico">
                <Icon name={r[0] as IconName} />
              </div>
              <b style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 20 }}>{r[1]}</b>
              <p className="muted small">{r[2]}</p>
            </Reveal>
          ))}
        </div>
        <div style={{ marginTop: 18 }}>
          <Link className="btn" href={ROUTES.network}>
            Read about the network <Icon name="arrow" />
          </Link>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="dk cta-band">
        <div className="wrap">
          <h2>Tell us what needs to get done.</h2>
          <div className="row wrapflex" style={{ marginTop: 26 }}>
            {user ? (
              <>
                <Link className="btn p lg" href={ROUTES.newTask}>
                  Start a new task
                </Link>
                <Link className="btn lg" href={user.accountType === "DEVELOPER" ? ROUTES.devDashboard : ROUTES.dashboard}>
                  Go to dashboard
                </Link>
              </>
            ) : (
              <>
                <button type="button" className="btn p lg" onClick={() => openRoleSelect()}>
                  Get started
                </button>
                <Link className="btn lg" href={ROUTES.agents}>
                  Explore agents
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
