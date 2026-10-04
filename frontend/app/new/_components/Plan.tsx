"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Agent, type Depth, type TaskEstimate } from "@/lib/api";
import { Avatar, Flow, Icon, Modal, Rating, Skeleton, SkeletonText, VerifiedTag, useToast } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { STARTING_CREDITS_CENTS } from "@/lib/data";
import { duration, eur, minutesRange, num, pct } from "@/lib/format";
import { useKeyboardShortcut } from "@/lib/hooks";
import { ROUTES, loginUrl, signupUrl } from "@/lib/routes";
import { DepthPicker } from "./DepthPicker";
import { clearDraft } from "./draft";

const RESUME = "/new?resume=1";

function isNew(a: Agent) {
  return a.tasksCompleted === 0 && a.rating === 0;
}

function whyList(a: Agent): string[] {
  return [
    `Specialized in ${a.specialty}.`,
    isNew(a)
      ? "Newly published: its performance record starts with tasks like yours."
      : `${pct(a.successRate)} success across ${num(a.tasksCompleted)} completed tasks.`,
    `Typically delivers in ${minutesRange(a.estMinutesLow, a.estMinutesHigh)}, inside your expected window.`,
    `Reputation ${a.reputation}/100 on the Agent Performance Graph.`,
  ];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Match signals derived from the agent's real record and this estimate. */
function scoreRows(a: Agent, est: TaskEstimate): [string, number][] {
  const need = est.capabilities.map((c) => c.toLowerCase());
  const has = new Set(a.capabilities.map((c) => c.toLowerCase()));
  const overlap = need.filter((c) => has.has(c)).length;
  const denom = Math.max(1, Math.min(need.length, a.capabilities.length));
  const pool = [est.leadAgent, ...est.alternatives];
  const minPrice = Math.min(...pool.map((x) => x.pricePerTaskCents));
  return [
    ["Capability fit", clamp(72 + (27 * overlap) / denom, 60, 99)],
    ["Track record on similar tasks", clamp(a.successRate, 0, 100)],
    ["Speed", clamp(100 - (a.avgRunSeconds / 60) * 1.4, 55, 98)],
    ["Price fit", clamp(99 - (40 * (a.pricePerTaskCents - minPrice)) / Math.max(minPrice, 1), 55, 99)],
  ];
}

function altBlurb(x: Agent, lead: Agent) {
  if (x.pricePerTaskCents < lead.pricePerTaskCents) return "Lower price, lighter output.";
  if (x.successRate > lead.successRate) return "Higher success rate, premium price.";
  return "Comparable fit.";
}

export function Plan({
  description,
  estimate,
  busy,
  error,
  depth,
  onDepth,
  onPickAgent,
  recommendedId,
  onEdit,
  onRetry,
}: {
  description: string;
  estimate: TaskEstimate | null;
  busy: boolean;
  error: string | null;
  depth: Depth;
  onDepth: (d: Depth) => void;
  onPickAgent: (id: string | null) => void;
  recommendedId: string | null;
  onEdit: () => void;
  onRetry: () => void;
}) {
  const { user, setUser } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [modal, setModal] = useState<null | "confirm" | "auth" | "insufficient">(null);
  const [starting, setStarting] = useState(false);
  const [shortfall, setShortfall] = useState<string | null>(null);

  const start = () => {
    if (!estimate || busy) return;
    if (!user) return setModal("auth");
    setShortfall(null);
    setModal(user.credits < estimate.costCents ? "insufficient" : "confirm");
  };
  useKeyboardShortcut("mod+enter", start, { allowInInputs: true, enabled: !!estimate && !busy && !modal });

  const confirm = async () => {
    if (!estimate) return;
    setStarting(true);
    try {
      const { task, user: u } = await api.createTask({
        description,
        title: estimate.title,
        depth: estimate.depth,
        agentId: estimate.leadAgent.id,
      });
      setUser(u);
      clearDraft();
      toast("Task started. Your team is on it.");
      router.push(ROUTES.task(task.id));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402) {
        setShortfall(err.message);
        setModal("insufficient");
      } else toast.error(err.message || "Couldn't start the task");
      setStarting(false);
    }
  };

  if (!estimate) {
    return (
      <div className="wrap">
        <Flow step={1} />
        {error ? (
          <div className="card" role="alert" style={{ marginTop: 20, maxWidth: 640 }}>
            <div className="notice" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>
              <Icon name="alert" />
              <span>{error}</span>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button type="button" className="btn" onClick={onEdit}>
                <Icon name="back" />
                Edit task
              </button>
              <button type="button" className="btn p" onClick={onRetry}>
                <Icon name="redo" />
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading your plan">
            <div className="pagehead" style={{ paddingTop: 14 }}>
              <Skeleton width={160} height={12} />
              <Skeleton width="60%" height={40} style={{ marginTop: 12 }} />
              <Skeleton width="80%" height={14} style={{ marginTop: 12 }} />
            </div>
            <div id="pg" className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", gap: 24 }}>
              <div className="card">
                <SkeletonText lines={8} />
              </div>
              <div className="card">
                <SkeletonText lines={6} />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const a = estimate.leadAgent;
  const team = estimate.team;
  const n = team.length;
  const known = new Map<string, Agent>([a, ...estimate.alternatives].map((x) => [x.id, x]));
  const balanceAfter = user ? user.credits - estimate.costCents : null;
  const swapped = recommendedId && a.id !== recommendedId;

  return (
    <div className="wrap">
      <Flow step={1} />
      <div className="pagehead" style={{ paddingTop: 14 }}>
        <div className="eyebrow">YOUR EXECUTION TEAM</div>
        <h1>{n === 1 ? "One specialist. One outcome." : `${n} specialists. One outcome.`}</h1>
        <p>
          {estimate.title}. Ensemblis broke the work into steps and matched each step to the best-performing agent.
        </p>
      </div>

      <div
        id="pg"
        className="grid"
        style={{ gridTemplateColumns: "1.5fr 1fr", gap: 24, alignItems: "start", opacity: busy ? 0.6 : 1, transition: "opacity .2s" }}
        aria-busy={busy}
      >
        <div className="stack">
          {/* Lead agent — prototype vMatch */}
          <div className="card pick">
            <div className="row wrapflex between">
              <span className="tag">
                <Icon name="spark" />
                {swapped ? "Your choice" : "Recommended lead"}
              </span>
              <VerifiedTag verified={a.verified} />
            </div>
            <div className="row" style={{ margin: "18px 0" }}>
              <Avatar name={a.name} hue={a.hue} size="lg" />
              <div>
                <h2 className="serif" style={{ fontSize: "clamp(24px,3.4vw,32px)", lineHeight: 1.1 }}>
                  {a.name}
                </h2>
                <div className="muted small">
                  by {a.creator} · {a.taskType}
                </div>
              </div>
            </div>
            <div className="grid g4 keep2" style={{ gap: 10 }}>
              <div className="stat">
                <b>{a.rating > 0 ? `${a.rating.toFixed(1)}/5` : "New"}</b>
                <span>Performance</span>
              </div>
              <div className="stat">
                <b>{num(a.tasksCompleted)}</b>
                <span>Tasks completed</span>
              </div>
              <div className="stat">
                <b>{a.successRate > 0 ? pct(a.successRate) : "—"}</b>
                <span>Success rate</span>
              </div>
              <div className="stat">
                <b>{a.avgRunSeconds > 0 ? duration(a.avgRunSeconds) : "—"}</b>
                <span>Avg. execution</span>
              </div>
            </div>
            <hr className="hr" />
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
              Why this agent
            </div>
            <ul style={{ listStyle: "none" }}>
              {whyList(a).map((w) => (
                <li key={w} className="row small" style={{ alignItems: "flex-start", padding: "4px 0", gap: 9 }}>
                  <span style={{ color: "var(--accent)", marginTop: 2 }}>
                    <Icon name="check" />
                  </span>
                  {w}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 12 }} aria-label="Match signals">
              {scoreRows(a, estimate).map(([l, v]) => (
                <div key={l} className="hbar" style={{ gridTemplateColumns: "190px 1fr 40px" }}>
                  <span className="muted">{l}</span>
                  <div className="b" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={l}>
                    <i style={{ width: `${v}%`, transition: "width .6s ease" }} />
                  </div>
                  <b>{v}</b>
                </div>
              ))}
            </div>
            <div className="row wrapflex" style={{ marginTop: 12, gap: 8 }}>
              <Link className="btn sm" href={ROUTES.agent(a.slug)}>
                View profile
              </Link>
              {swapped && (
                <button type="button" className="btn sm ghost" onClick={() => onPickAgent(null)} disabled={busy}>
                  <Icon name="redo" />
                  Back to the recommended agent
                </button>
              )}
            </div>
          </div>

          {/* Team pipeline */}
          <div className="card">
            <div className="row wrapflex between" style={{ marginBottom: 14 }}>
              <b>How the work flows</b>
              <span className="muted small">
                {n} {n === 1 ? "step" : "steps"} · {minutesRange(estimate.estMinutesLow, estimate.estMinutesHigh)} · {eur(estimate.costCents)} total
              </span>
            </div>
            <div className="pipe">
              {team.map((m, k) => {
                const ag = known.get(m.agentId);
                return (
                  <Fragment key={`${m.agentId}-${k}`}>
                    <div className="pnode reveal" style={{ animationDelay: `${k * 90}ms` }}>
                      <div className="row" style={{ marginBottom: 10, gap: 10 }}>
                        <Avatar name={m.agentName} hue={ag?.hue} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="tiny muted">
                            0{k + 1} · {m.role}
                          </div>
                          <b className="small">{m.agentName}</b>
                        </div>
                      </div>
                      <div className="tiny muted">{m.title}</div>
                      {m.agentId === a.id && (
                        <span className="tag" style={{ marginTop: 8 }}>
                          Lead
                        </span>
                      )}
                    </div>
                    {k < n - 1 && (
                      <div className="parrow" aria-hidden="true">
                        <Icon name="arrow" />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
            <hr className="hr" />
            <div className="tiny muted" style={{ marginBottom: 8 }}>
              Why this team
            </div>
            <div className="row wrapflex" style={{ gap: 8 }}>
              <span className="chip">
                <Icon name="check" />
                Each step goes to its best-performing agent
              </span>
              <span className="chip">
                <Icon name="check" />
                Every handoff carries the full context
              </span>
              <span className="chip">
                <Icon name="check" />
                One price and one refund policy
              </span>
            </div>
          </div>

          {/* Alternatives */}
          {estimate.alternatives.length > 0 && (
            <div>
              <div className="small muted" style={{ fontWeight: 600, marginBottom: 10 }}>
                Alternatives for the lead step
              </div>
              <div className="grid g3" style={{ gap: 12 }}>
                {estimate.alternatives.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className="card tight opt"
                    style={{ textAlign: "left" }}
                    onClick={() => onPickAgent(x.id)}
                    disabled={busy}
                    aria-label={`Choose ${x.name} instead`}
                  >
                    <div className="row" style={{ gap: 10 }}>
                      <Avatar name={x.name} hue={x.hue} size="sm" />
                      <div className="sp" style={{ minWidth: 0 }}>
                        <b className="small">{x.name}</b>
                        <div className="tiny muted">{x.creator}</div>
                      </div>
                    </div>
                    <div className="row wrapflex small muted" style={{ marginTop: 10, gap: 12 }}>
                      {x.rating > 0 ? <Rating value={x.rating} /> : <span>New</span>}
                      <span>{x.successRate > 0 ? `${pct(x.successRate)} success` : "No record yet"}</span>
                      <span>Typical {eur(x.pricePerTaskCents)}</span>
                    </div>
                    <div className="tiny" style={{ marginTop: 8, color: "var(--muted)" }}>
                      {altBlurb(x, a)} <span style={{ color: "var(--accent)", fontWeight: 600 }}>Choose instead</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* What you'll receive — prototype vCheckout */}
          <div className="card flat">
            <b className="small">What you&apos;ll receive</b>
            <ul className="small muted" style={{ margin: "8px 0 0 18px" }}>
              <li>A complete {a.outputType.toLowerCase()} you can act on or share</li>
              <li>Live progress while each agent works, with every step&apos;s output</li>
              <li>A full refund, automatically, if any step fails</li>
            </ul>
          </div>
          <div className="small muted" style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
            <Icon name="shield" />
            <span>Every agent on Ensemblis passed capability, safety and performance checks.</span>
          </div>
        </div>

        {/* Summary + checkout — prototype vPlan .psum + vCheckout */}
        <div className="card psum" style={{ position: "sticky", top: 84 }}>
          <div className="tiny muted">Total price</div>
          <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
            <b style={{ fontSize: 34, fontFamily: "var(--serif)", letterSpacing: "-.02em" }} aria-live="polite">
              {eur(estimate.costCents)}
            </b>
            <span className="muted small">one price, whole team</span>
          </div>
          <div style={{ margin: "14px 0 6px" }}>
            <div className="l" id="plan-depth-label" style={{ marginBottom: 8 }}>
              Depth
            </div>
            <DepthPicker id="plan-depth" value={depth} onChange={onDepth} disabled={busy} />
          </div>
          <div className="kv">
            <span>Estimated time</span>
            <b>{minutesRange(estimate.estMinutesLow, estimate.estMinutesHigh)}</b>
          </div>
          <div className="kv">
            <span>vs. doing it manually</span>
            <b>~{estimate.manualHoursEstimate} hours</b>
          </div>
          <div className="kv">
            <span>Deliverable</span>
            <b>{a.outputType}</b>
          </div>
          <div className="kv">
            <span>Platform fee</span>
            <span>Included</span>
          </div>
          <div className="kv">
            <span>Balance after</span>
            {user && balanceAfter !== null ? (
              <b style={balanceAfter < 0 ? { color: "var(--bad)" } : undefined}>
                {eur(user.credits)} → {eur(balanceAfter)}
              </b>
            ) : (
              <span className="small">New accounts get {eur(STARTING_CREDITS_CENTS)} in demo credits</span>
            )}
          </div>
          <button type="button" className="btn p lg block" style={{ marginTop: 16 }} onClick={start} disabled={busy} aria-busy={busy}>
            {user ? `Start task — ${eur(estimate.costCents)}` : `Continue — ${eur(estimate.costCents)}`}
          </button>
          <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={onEdit}>
            <Icon name="edit" />
            Edit task
          </button>
          <div className="notice" style={{ marginTop: 14, background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Icon name="shield" />
            <span>
              <b>Outcome guarantee.</b> If any step fails, the full price returns to your credits automatically.
            </span>
          </div>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Agents are chosen using the Agent Performance Graph: Ensemblis learns which agents perform best for specific types of work.
          </p>
        </div>
      </div>

      {/* Confirm — prototype confirmHtml() */}
      <Modal open={modal === "confirm"} onClose={() => !starting && setModal(null)} title="Confirm task" dismissible={!starting}>
        <p className="muted" style={{ margin: "2px 0 14px" }}>
          {estimate.title}
        </p>
        <div className="kv">
          <span>Cost</span>
          <b>{eur(estimate.costCents)} demo credits</b>
        </div>
        <div className="kv">
          <span>Team</span>
          <b>
            {n} {n === 1 ? "agent" : "agents"} · led by {a.name}
          </b>
        </div>
        <div className="kv">
          <span>Estimated completion</span>
          <b>{minutesRange(estimate.estMinutesLow, estimate.estMinutesHigh)}</b>
        </div>
        {user && (
          <div className="kv">
            <span>Remaining balance</span>
            <b>
              {eur(user.credits)} → {eur(user.credits - estimate.costCents)}
            </b>
          </div>
        )}
        <div className="kv">
          <span>Payment method</span>
          <b>Ensemblis Demo Credits</b>
        </div>
        <div className="notice" style={{ margin: "14px 0", background: "var(--accent-soft)", color: "var(--accent)" }}>
          <Icon name="shield" />
          <span>Demo environment. No real payment will be charged. If a step fails, you&apos;re refunded automatically.</span>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setModal(null)} disabled={starting}>
            Cancel
          </button>
          <button type="button" className="btn p lg sp" onClick={confirm} aria-busy={starting} disabled={starting} data-autofocus>
            Confirm &amp; start task
          </button>
        </div>
      </Modal>

      {/* Insufficient credits — prototype insufficientHtml() */}
      <Modal open={modal === "insufficient"} onClose={() => setModal(null)} title="Insufficient demo credits">
        <p className="muted" style={{ margin: "2px 0 16px" }}>
          {shortfall ??
            `This task costs ${eur(estimate.costCents)}, but your demo account has ${eur(user?.credits ?? 0)} left.`}
        </p>
        <div className="notice" style={{ marginBottom: 16, background: "var(--warn-soft)", color: "var(--warn)" }}>
          <Icon name="shield" />
          <span>This is a demo limit only. Add demo credits to keep going — nothing is ever really charged. Your plan is saved.</span>
        </div>
        <div className="row wrapflex">
          <button type="button" className="btn" onClick={() => setModal(null)}>
            Cancel
          </button>
          {depth !== "focused" && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setModal(null);
                onDepth("focused");
              }}
            >
              Try Focused depth
            </button>
          )}
          <Link className="btn p lg sp" href={ROUTES.billing} data-autofocus>
            Add demo credits
          </Link>
        </div>
      </Modal>

      {/* Logged-out visitors: sign in at confirm time, draft is kept */}
      <Modal open={modal === "auth"} onClose={() => setModal(null)} title="Create your account to start">
        <p className="muted" style={{ margin: "2px 0 14px" }}>
          Your plan is saved. Sign up or log in and you&apos;ll come straight back here to confirm it.
        </p>
        <div className="kv">
          <span>Task</span>
          <b style={{ textAlign: "right", maxWidth: "60%" }}>{estimate.title}</b>
        </div>
        <div className="kv">
          <span>Price</span>
          <b>{eur(estimate.costCents)}</b>
        </div>
        <div className="notice" style={{ margin: "14px 0", background: "var(--accent-soft)", color: "var(--accent)" }}>
          <Icon name="spark" />
          <span>New accounts start with {eur(STARTING_CREDITS_CENTS)} in demo credits. No card needed.</span>
        </div>
        <div className="row">
          <Link className="btn" href={loginUrl(RESUME)}>
            Log in
          </Link>
          <Link className="btn p lg sp" href={signupUrl("company", RESUME)} data-autofocus>
            Create free account
          </Link>
        </div>
      </Modal>
    </div>
  );
}
