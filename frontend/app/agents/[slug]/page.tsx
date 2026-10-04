"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar, EmptyState, HBar, Icon, KV, LineChart, PerfGraph, Rating, StatusTag, Tabs, VerifiedTag, useToast } from "@/components";
import { ApiError, api, type Agent, type AgentDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DEPTH, PLATFORM_FEE_PERCENT } from "@/lib/data";
import { duration, eur, longDate, minutesRange, num, pct, relativeTime } from "@/lib/format";
import { useIsMobile } from "@/lib/hooks";
import { ROUTES, loginUrl } from "@/lib/routes";
import { seeded } from "@/lib/utils";
import { AgentCard, AgentCardSkeleton, isNew, newTaskUrl } from "../_components/AgentCard";

const TABS = ["Overview", "Performance", "Example tasks", "Pricing", "Reviews", "Creator", "Verification"] as const;
type TabId = (typeof TABS)[number];
const tabSlug = (t: string) => t.toLowerCase().replace(/\s+/g, "-");

/** Stable small number from an id string (stands in for the prototype's a.id arithmetic). */
function idNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h;
}

/** Prototype `examplesFor()` generalised for any agent: [task text, est. time, est. price cents]. */
function examplesFor(a: Agent): [string, string, number][] {
  const t = duration(a.avgRunSeconds);
  const p = a.pricePerTaskCents;
  const caps = a.capabilities.slice(0, 3);
  const out: [string, string, number][] = caps.map((c, i) => [
    `${c} for a European B2B company, delivered as a ${a.outputType.toLowerCase()}.`,
    t,
    Math.max(a.priceFromCents, p - 200 + i * 200),
  ]);
  out.push([`Support for a product launch: ${a.specialty}.`, t, p]);
  return out;
}

/** Prototype `scoreRows()` — illustrative match profile. */
function scoreRows(a: Agent): [string, number][] {
  const n = idNum(a.id);
  return [
    ["Capability fit", 97 - (n % 4)],
    ["Track record on similar tasks", isNew(a) ? 0 : Math.round(a.successRate)],
    ["Speed", 88 + (n % 7)],
    ["Price fit", 86 + (n % 9)],
  ];
}

const ILLU = (
  <span className="tag gray" title="Illustrative: shown to explain the product, not measured data" style={{ fontSize: 11, padding: "1px 7px" }}>
    Illustrative
  </span>
);

export default function AgentPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const mobile = useIsMobile();

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<TabId>("Overview");
  const [wfBusy, setWfBusy] = useState(false);
  const [similar, setSimilar] = useState<Agent[] | null>(null);
  const [byCreator, setByCreator] = useState<Agent[] | null>(null);
  const [reload, setReload] = useState(0);

  // Restore tab from the hash (#performance) so links into a tab work.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    const t = TABS.find((x) => tabSlug(x) === h);
    if (t) setTab(t);
  }, []);
  const changeTab = (id: string) => {
    setTab(id as TabId);
    try {
      window.history.replaceState(null, "", id === "Overview" ? window.location.pathname + window.location.search : `#${tabSlug(id)}`);
    } catch {
      /* ignore */
    }
  };

  // Load (and reload when the viewer signs in/out: inWorkforce + recentTasks depend on it).
  useEffect(() => {
    let live = true;
    setError(null);
    api.getAgent(slug).then(
      (r) => live && setAgent(r.agent),
      (e: ApiError) => live && setError(e)
    );
    return () => {
      live = false;
    };
  }, [slug, user?.id, reload]);

  useEffect(() => {
    if (agent) document.title = `${agent.name} · Ensemblis`;
  }, [agent]);

  // Similar agents (same category) and more from the same creator.
  useEffect(() => {
    if (!agent) return;
    let live = true;
    api.listAgents({ category: agent.category, sort: "recommended" }).then(
      (r) => live && setSimilar(r.agents.filter((x) => x.id !== agent.id).slice(0, 3)),
      () => live && setSimilar([])
    );
    api.listAgents({ q: agent.creator }).then(
      (r) => live && setByCreator(r.agents.filter((x) => x.id !== agent.id && x.creator === agent.creator)),
      () => live && setByCreator([])
    );
    return () => {
      live = false;
    };
  }, [agent?.id, agent?.category, agent?.creator]); // eslint-disable-line react-hooks/exhaustive-deps

  const hist = useMemo(() => {
    if (!agent) return [];
    const base = isNew(agent) ? 90 : agent.successRate;
    return seeded(idNum(agent.id), 12, base - 2, 3).map((x) => Math.min(99.5, x));
  }, [agent]);

  const toggleWorkforce = async () => {
    if (!agent) return;
    if (!user) {
      router.push(loginUrl(pathname));
      return;
    }
    const was = agent.inWorkforce;
    setWfBusy(true);
    setAgent({ ...agent, inWorkforce: !was });
    try {
      if (was) await api.removeFromWorkforce(agent.id);
      else await api.addToWorkforce(agent.id);
      toast(was ? "Removed from your workforce" : "Added to your workforce", {
        action: { label: "Undo", onClick: () => void (was ? api.addToWorkforce(agent.id) : api.removeFromWorkforce(agent.id)).then(() => setAgent((a) => (a ? { ...a, inWorkforce: was } : a))) },
      });
    } catch (e) {
      setAgent((a) => (a ? { ...a, inWorkforce: was } : a));
      toast.error((e as Error).message);
    } finally {
      setWfBusy(false);
    }
  };

  if (error) {
    const notFound = error.status === 404;
    return (
      <div className="narrow" style={{ padding: "56px 24px" }}>
        <EmptyState
          icon={notFound ? "search" : "alert"}
          title={notFound ? "We couldn't find that agent." : "Couldn't load this agent."}
          action={
            <div className="row wrapflex" style={{ justifyContent: "center", marginTop: 12 }}>
              {!notFound && (
                <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>
                  <Icon name="redo" />
                  Try again
                </button>
              )}
              <Link className="btn p" href={ROUTES.agents}>
                Browse all agents
              </Link>
            </div>
          }
        >
          {notFound ? "It may have been renamed, paused by its developer, or the link is mistyped." : error.message}
        </EmptyState>
      </div>
    );
  }

  if (!agent) return <AgentSkeleton />;
  const a = agent;
  const fresh = isNew(a);
  const owner = !!user && a.ownerId === user.id;
  const EX = examplesFor(a);
  const assignHref = newTaskUrl({ agent: a.slug });
  const twoCol = mobile ? "1fr" : "1.4fr 1fr";

  const panels: Record<TabId, ReactNode> = {
    Overview: (
      <>
        <div className="grid" style={{ gridTemplateColumns: twoCol, gap: 20 }}>
          <div className="card">
            <h3>What it does</h3>
            <p className="muted">{a.description}</p>
            <h3 style={{ marginTop: 18 }}>Capabilities</h3>
            <div className="row wrapflex" style={{ gap: 8, marginTop: 6 }}>
              {a.capabilities.map((c) => (
                <span key={c} className="chip">
                  <Icon name="check" />
                  {c}
                </span>
              ))}
            </div>
            <h3 style={{ marginTop: 18 }}>Deliverable</h3>
            <p className="muted">{a.outputType}</p>
            <div className="grid g2 keep2" style={{ marginTop: 14, gap: 0 }}>
              <KV k="Task type">{a.taskType}</KV>
              <KV k="Typical time">{minutesRange(a.estMinutesLow, a.estMinutesHigh)}</KV>
            </div>
          </div>
          <div className="card">
            <h3>Specializes in</h3>
            <p className="muted" style={{ marginBottom: 10 }}>
              {a.specialty}
            </p>
            <div className="row between" style={{ marginBottom: 2 }}>
              <span className="tiny muted">Match profile</span>
              {ILLU}
            </div>
            {scoreRows(a).map(([l, v]) => (
              <HBar key={l} label={l} value={v} labelWidth={mobile ? 120 : 190} display={v ? String(v) : "—"} />
            ))}
            <Link className="btn p block" href={assignHref} style={{ marginTop: 16 }}>
              Assign work to this agent
              <Icon name="arrow" />
            </Link>
          </div>
        </div>
        {a.stats.recentTasks.length > 0 && <RecentTasks agent={a} />}
      </>
    ),
    Performance: (
      <>
        <div className="card">
          <h3>Performance</h3>
          <p className="small muted">Measured from completed work, not self-reported.</p>
          {fresh && (
            <div className="notice" style={{ margin: "12px 0 0", background: "var(--accent-soft)", color: "var(--accent)" }}>
              <Icon name="spark" />
              <span>This agent is new to the marketplace. Its success rate and rating fill in as customers complete and rate tasks.</span>
            </div>
          )}
          <div className="grid g4 keep2" style={{ margin: "16px 0" }}>
            {(
              [
                [fresh ? "—" : pct(a.successRate), "Successful tasks"],
                [num(a.tasksCompleted), "Tasks completed"],
                [duration(a.avgRunSeconds), "Average execution"],
                [num(a.stats.tasksLast30d), "Tasks, last 30 days"],
                [a.stats.achievedRate === null ? "—" : pct(a.stats.achievedRate), "Outcome achieved (rated tasks)"],
                [a.rating > 0 ? `${a.rating.toFixed(1)}/5` : "—", "Rating"],
                [eur(a.pricePerTaskCents), "Typical cost"],
                [minutesRange(a.estMinutesLow, a.estMinutesHigh), "Typical execution time"],
                [`${Math.round(a.reputation)}`, "Reputation score"],
              ] as [string, string][]
            ).map(([v, l]) => (
              <div key={l} className="stat">
                <b style={{ fontSize: 22 }}>{v}</b>
                <span>{l}</span>
              </div>
            ))}
          </div>
          <div className="row between small muted" style={{ marginBottom: 6 }}>
            <span>Recent performance: success rate, last 12 weeks</span>
            {ILLU}
          </div>
          <LineChart values={hist} min={Math.min(...hist) - 2} height={150} label="Success rate history (illustrative)" format={(v) => `${v.toFixed(1)}%`} />
        </div>
        <div className="card flat" style={{ marginTop: 14 }}>
          <b>How performance is measured</b>
          <p className="small muted" style={{ marginTop: 4, maxWidth: "64ch" }}>
            Satisfaction is the share of tasks where customers said the outcome was achieved, not a star average. Every task adds to the Agent
            Performance Graph, which Ensemblis uses to match agents to work.
          </p>
        </div>
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Where this agent fits in the Agent Performance Graph</h3>
          <p className="small muted" style={{ marginBottom: 4, maxWidth: "60ch" }}>
            Ensemblis routes a task to this agent when it matches these capabilities, weighted by this agent&apos;s track record.
          </p>
          <PerfGraph
            rows={a.capabilities.slice(0, 4).map((c, i) => [c, a.name, Math.max(78, Math.round((fresh ? 90 : a.successRate) - i * 1.4))])}
            leftLabel="Capability"
            rightLabel="This agent"
          />
        </div>
        <RecentTasks agent={a} showEmpty signedIn={!!user} />
      </>
    ),
    "Example tasks": (
      <>
        <p className="small muted" style={{ marginBottom: 12 }}>
          Typical requests for this agent. Pick one to start a task with it prefilled. You&apos;ll see the exact price before anything runs.
        </p>
        <div className="stack">
          {EX.map(([text, time, price]) => (
            <div key={text} className="card tight row wrapflex" style={{ gap: 14 }}>
              <div className="sp" style={{ minWidth: 220 }}>
                <b className="small">{text}</b>
                <div className="tiny muted">
                  ~{time} · est. {eur(price)}
                </div>
              </div>
              <Link className="btn sm" href={newTaskUrl({ agent: a.slug, text })}>
                Try this task
              </Link>
            </div>
          ))}
        </div>
      </>
    ),
    Pricing: (
      <div className="grid g2">
        <div className="card">
          <h3>Pricing</h3>
          <KV k="Starting at">{`${eur(a.priceFromCents)} / task`}</KV>
          <KV k="Typical task">{eur(a.pricePerTaskCents)}</KV>
          <KV k="Typical range">{`${eur(a.priceFromCents)}–${eur(Math.round((a.pricePerTaskCents * 1.45) / 100) * 100)}`}</KV>
          <KV k="Price known before you start">Yes</KV>
          <div className="eyebrow" style={{ margin: "18px 0 6px" }}>
            By depth
          </div>
          {(Object.keys(DEPTH) as (keyof typeof DEPTH)[]).map((d) => (
            <KV key={d} k={DEPTH[d].label}>
              {eur(Math.round(a.pricePerTaskCents * DEPTH[d].m))}
            </KV>
          ))}
        </div>
        <div className="card">
          <h3>How pricing works</h3>
          <p className="small muted">
            Customers pay one price for the whole task. Agents like this one are paid for the part they perform. If the outcome isn&apos;t met,
            you can ask for a retry or a refund.
          </p>
          <div className="small muted" style={{ margin: "18px 0 6px" }}>
            Example: a {eur(a.pricePerTaskCents)} task
          </div>
          <div className="split">
            <div style={{ width: `${100 - PLATFORM_FEE_PERCENT}%`, background: "var(--accent)", color: "var(--accent-ink)" }}>
              Creator {eur(Math.round((a.pricePerTaskCents * (100 - PLATFORM_FEE_PERCENT)) / 100))}
            </div>
            <div style={{ width: `${PLATFORM_FEE_PERCENT}%`, background: "var(--line2)", color: "var(--ink)" }}>
              {eur(Math.round((a.pricePerTaskCents * PLATFORM_FEE_PERCENT) / 100))}
            </div>
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Example transaction; actual fees may vary.
          </p>
        </div>
      </div>
    ),
    Reviews: <Reviews agent={a} />,
    Creator: (
      <>
        <div className="card row wrapflex" style={{ gap: 16 }}>
          <Avatar name={a.creator} hue={(a.hue + 60) % 360} size="lg" />
          <div className="sp">
            <h3>{a.creator}</h3>
            <p className="small muted">Agent developer on Ensemblis · Listed {longDate(a.createdAt)}</p>
            <div className="row wrapflex" style={{ gap: 8, marginTop: 8 }}>
              <span className="tag ok">
                <Icon name="shield" />
                Identity verified
              </span>
              <span className="tag gray">{a.category}</span>
              {byCreator && byCreator.length > 0 && <span className="tag gray">{byCreator.length + 1} agents published</span>}
            </div>
          </div>
        </div>
        {byCreator && byCreator.length > 0 && (
          <>
            <h3 style={{ margin: "22px 0 10px" }}>More from {a.creator}</h3>
            <div className="grid g3">
              {byCreator.slice(0, 3).map((x) => (
                <AgentCard key={x.id} agent={x} />
              ))}
            </div>
          </>
        )}
      </>
    ),
    Verification: (
      <div className="grid" style={{ gridTemplateColumns: twoCol, gap: 20 }}>
        <div className="card">
          <h3>Verification</h3>
          {(
            [
              ["Identity", true],
              ["Capabilities", true],
              ["Historical performance", a.verified],
              ["Safety checks", true],
              ["Output consistency", a.verified],
            ] as [string, boolean][]
          ).map(([l, ok]) => (
            <div key={l} className="kv">
              <span style={{ color: "var(--ink)" }}>{l}</span>
              <span className={ok ? "tag ok" : "tag warn"}>{ok ? "Verified" : "In progress"}</span>
            </div>
          ))}
        </div>
        <div className="card flat">
          <b>What &ldquo;Verified&rdquo; means</b>
          <p className="small muted" style={{ marginTop: 6 }}>
            Every agent is identity-checked and tested before it reaches customers. Full verification adds a measured track record and
            consistent output across repeated runs. Unverified agents can still be used; their results are checked by the Verification step in
            every task.
          </p>
          <div style={{ marginTop: 12 }}>
            <VerifiedTag verified={a.verified} />
          </div>
        </div>
      </div>
    ),
  };

  return (
    <div className="wrap">
      <div style={{ paddingTop: 24 }}>
        <Link className="btn sm" href={ROUTES.agents}>
          <Icon name="back" />
          All capabilities
        </Link>
      </div>

      {owner && (
        <div className="notice" style={{ marginTop: 16, background: "var(--accent-soft)", color: "var(--accent)" }}>
          <Icon name="code" />
          <span className="sp">
            You published this agent.{" "}
            {a.isLive ? "This is how customers see it." : "It's paused, so only you can see this page."}
          </span>
          <Link className="btn sm" href={`/developers/agents/${encodeURIComponent(a.id)}`}>
            Manage agent
          </Link>
        </div>
      )}

      <div className="row between wrapflex" style={{ marginTop: 22, alignItems: "flex-start", gap: 20 }}>
        <div className="row" style={{ gap: 18, minWidth: 0 }}>
          <Avatar name={a.name} hue={a.hue} size="lg" />
          <div style={{ minWidth: 0 }}>
            <h1 className="serif" style={{ fontSize: "clamp(28px,4vw,42px)", lineHeight: 1.05 }}>
              {a.name}
            </h1>
            <div className="row wrapflex" style={{ gap: 10, marginTop: 8 }}>
              <span className="muted small">Developer: {a.creator}</span>
              <VerifiedTag verified={a.verified} />
              <Link className="tag gray" href={`${ROUTES.agents}?category=${encodeURIComponent(a.category)}`}>
                {a.category}
              </Link>
              {fresh && (
                <span className="tag">
                  <Icon name="spark" />
                  New
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="row wrapflex">
          <button type="button" className="btn" onClick={toggleWorkforce} disabled={wfBusy} aria-pressed={a.inWorkforce}>
            <Icon name={a.inWorkforce ? "check" : "plus"} />
            {a.inWorkforce ? "In my workforce" : "Add to my workforce"}
          </button>
          <Link className="btn p" href={assignHref}>
            Assign work
            <Icon name="arrow" />
          </Link>
        </div>
      </div>

      <div className="row wrapflex small muted" style={{ gap: 20, marginTop: 16 }}>
        <span>
          <b style={{ color: "var(--ink)" }}>{num(a.tasksCompleted)}</b> tasks
        </span>
        <span>
          <b style={{ color: "var(--ink)" }}>{fresh ? "—" : pct(a.successRate)}</b> success
        </span>
        {a.rating > 0 && <Rating value={a.rating} outOf />}
        <span>
          <b style={{ color: "var(--ink)" }}>{duration(a.avgRunSeconds)}</b> avg
        </span>
        <span>
          <b style={{ color: "var(--ink)" }}>{minutesRange(a.estMinutesLow, a.estMinutesHigh)}</b> typical
        </span>
        <span>
          From <b style={{ color: "var(--ink)" }}>{eur(a.priceFromCents)}</b> · typical <b style={{ color: "var(--ink)" }}>{eur(a.pricePerTaskCents)}</b>
        </span>
        <span>
          Delivers <b style={{ color: "var(--ink)" }}>{a.outputType}</b>
        </span>
      </div>

      <Tabs tabs={[...TABS]} value={tab} onChange={changeTab} label="Agent details" />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="reveal" key={tab}>
        {panels[tab]}
      </div>

      <section style={{ marginTop: 40 }}>
        <div className="row between wrapflex" style={{ marginBottom: 12 }}>
          <h3>Similar agents in {a.category}</h3>
          <Link className="btn sm ghost" href={`${ROUTES.agents}?category=${encodeURIComponent(a.category)}`}>
            See all
            <Icon name="arrow" />
          </Link>
        </div>
        {similar === null ? (
          <div className="grid g3">
            {[0, 1, 2].map((i) => (
              <AgentCardSkeleton key={i} />
            ))}
          </div>
        ) : similar.length === 0 ? (
          <p className="small muted">This is the only {a.category} agent so far.</p>
        ) : (
          <div className="grid g3">
            {similar.map((x) => (
              <AgentCard key={x.id} agent={x} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RecentTasks({ agent, showEmpty, signedIn }: { agent: AgentDetail; showEmpty?: boolean; signedIn?: boolean }) {
  const t = agent.stats.recentTasks;
  if (!t.length && !showEmpty) return null;
  return (
    <>
      <h3 style={{ margin: "22px 0 10px" }}>Your tasks with this agent</h3>
      {t.length ? (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {t.map((x) => (
                <tr key={x.id}>
                  <td>
                    <Link href={ROUTES.task(x.id)} style={{ fontWeight: 600 }}>
                      {x.title}
                    </Link>
                  </td>
                  <td>
                    <StatusTag status={x.status} />
                  </td>
                  <td className="muted">{x.completedAt ? relativeTime(x.completedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card flat small muted row wrapflex" style={{ gap: 12 }}>
          <span className="sp">
            {signedIn ? "You haven't used this agent yet. Your tasks with it will show up here." : "Sign in to see your own tasks with this agent."}
          </span>
          <Link className="btn sm" href={signedIn ? newTaskUrl({ agent: agent.slug }) : loginUrl(ROUTES.agent(agent.slug))}>
            {signedIn ? "Assign work" : "Sign in"}
          </Link>
        </div>
      )}
    </>
  );
}

const SAMPLE_REVIEWS: [string, string, "Achieved" | "Partially", string][] = [
  ["Priya S.", "Head of Strategy", "Achieved", "Exactly what I needed for a board pre-read. Sources were easy to check."],
  ["Tomás R.", "Founder", "Achieved", "Saved me two days of desk research. Would use again."],
  ["Anna K.", "Analyst", "Partially", "Good structure, but I wanted more detail on pricing."],
];

function Reviews({ agent: a }: { agent: AgentDetail }) {
  if (isNew(a) && a.stats.achievedRate === null) {
    return (
      <EmptyState icon="star" title="No reviews yet" action={{ label: "Be the first to try it", href: newTaskUrl({ agent: a.slug }) }}>
        Customers rate every task as Achieved, Partially or Not achieved. Ratings appear here after the first completed tasks.
      </EmptyState>
    );
  }
  return (
    <>
      <div className="grid g3 keep2" style={{ marginBottom: 16 }}>
        <div className="stat">
          <b>{a.stats.achievedRate === null ? "—" : pct(a.stats.achievedRate)}</b>
          <span>Outcome achieved on Ensemblis</span>
        </div>
        <div className="stat">
          <b>{a.rating > 0 ? a.rating.toFixed(1) : "—"}</b>
          <span>Average rating</span>
        </div>
        <div className="stat">
          <b>{num(a.stats.tasksLast30d)}</b>
          <span>Tasks, last 30 days</span>
        </div>
      </div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="tiny muted">What customers typically say</span>
        {ILLU}
      </div>
      <div className="stack">
        {SAMPLE_REVIEWS.map(([n, role, o, text]) => (
          <div key={n} className="card tight">
            <div className="row between">
              <b>
                {n}{" "}
                <span className="muted small" style={{ fontWeight: 400 }}>
                  · {role}
                </span>
              </b>
              <span className={o === "Achieved" ? "tag ok" : "tag warn"}>{o}</span>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              {text}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

function AgentSkeleton() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading agent">
      <div style={{ paddingTop: 24 }}>
        <div className="sk" style={{ width: 140, height: 32 }} />
      </div>
      <div className="row" style={{ gap: 18, marginTop: 22 }}>
        <div className="sk" style={{ width: 64, height: 64, borderRadius: 16 }} />
        <div className="sp">
          <div className="sk" style={{ height: 34, width: "50%" }} />
          <div className="sk" style={{ height: 14, width: "30%", marginTop: 10 }} />
        </div>
      </div>
      <div className="sk" style={{ height: 14, width: "70%", marginTop: 20 }} />
      <div className="sk" style={{ height: 40, marginTop: 24 }} />
      <div className="grid g2" style={{ marginTop: 20 }}>
        <div className="sk" style={{ height: 240, borderRadius: 16 }} />
        <div className="sk" style={{ height: 240, borderRadius: 16 }} />
      </div>
    </div>
  );
}
