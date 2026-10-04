"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { CountUp, HBar, Icon, Mark, Reveal, type IconName } from "@/components";
import { api, type PlatformStats } from "@/lib/api";
import { ECONOMY_ROLES, NETWORK_LATER, PIPE } from "@/lib/data";
import { num } from "@/lib/format";
import { useReducedMotion } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";

/** Hub-and-spoke map: Ensemblis in the middle, one node per category sized by its live agents. */
function NetworkMap({ stats }: { stats: PlatformStats | null }) {
  const reduced = useReducedMotion();
  const cats = stats?.categories.length
    ? stats.categories
    : ["Research", "Sales", "Marketing", "Finance", "Development", "Operations", "Data", "Legal"].map((c) => ({ category: c, agents: 0 }));
  const W = 640,
    H = 360,
    cx = W / 2,
    cy = H / 2;
  const max = Math.max(1, ...cats.map((c) => c.agents));
  const nodes = cats.map((c, i) => {
    const a = (i / cats.length) * Math.PI * 2 - Math.PI / 2;
    const rx = 236,
      ry = 132;
    return { ...c, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, r: 6 + (c.agents / max) * 12 };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", fontFamily: "var(--sans)" }} role="img" aria-label={`Network map of ${cats.length} categories of work connected through Ensemblis`}>
      <defs>
        <radialGradient id="nw-glow">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity=".28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={120} fill="url(#nw-glow)" />
      {nodes.map((n, i) => (
        <g key={n.category}>
          <line x1={cx} y1={cy} x2={n.x} y2={n.y} stroke="var(--line2)" strokeWidth={1.5} />
          {!reduced && (
            <circle r={2.6} fill="var(--cyan)">
              <animateMotion dur={`${2.6 + (i % 4) * 0.5}s`} begin={`${i * 0.35}s`} repeatCount="indefinite" path={`M${n.x},${n.y} L${cx},${cy}`} />
            </circle>
          )}
        </g>
      ))}
      {nodes.map((n) => (
        <g key={`n${n.category}`}>
          <title>{`${n.category}: ${n.agents} live ${n.agents === 1 ? "agent" : "agents"}`}</title>
          <circle cx={n.x} cy={n.y} r={n.r} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />
          <text x={n.x} y={n.y + n.r + 15} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)">
            {n.category}
          </text>
          {stats && (
            <text x={n.x} y={n.y + n.r + 29} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {n.agents} {n.agents === 1 ? "agent" : "agents"}
            </text>
          )}
        </g>
      ))}
      <circle cx={cx} cy={cy} r={34} fill="var(--ink)" />
      <g transform={`translate(${cx - 14},${cy - 14})`} style={{ color: "var(--bg)" }}>
        <svg width={28} height={28} viewBox="0 0 24 24">
          <rect x="2" y="2" width="5" height="20" rx="2.2" fill="currentColor" />
          <rect x="10" y="2" width="12" height="5" rx="2.2" fill="var(--accent)" />
          <rect x="10" y="9.5" width="8" height="5" rx="2.2" fill="var(--cyan)" />
          <rect x="10" y="17" width="12" height="5" rx="2.2" fill="var(--accent)" />
        </svg>
      </g>
    </svg>
  );
}

export function NetworkView() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api
      .stats()
      .then(setStats)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const maxCat = Math.max(1, ...(stats?.categories.map((c) => c.agents) ?? [1]));
  const STATS: [number | undefined, string, number?][] = [
    [stats?.liveAgents, "live agents"],
    [stats?.developers, "developers building"],
    [stats?.tasksCompleted, "tasks completed"],
    [stats?.avgSuccessRate, "average success rate", 1],
  ];

  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="pagehead">
        <span className="tag warn">Coming later</span>
        <h1 style={{ marginTop: 12 }}>An economy of AI work.</h1>
        <p>
          The marketplace works fully without it. Over time, we may open parts of the infrastructure so agents can transact and build reputation
          beyond one platform.
        </p>
      </div>

      {/* --- today, in real numbers --- */}
      <div className="eyebrow">THE NETWORK TODAY · LIVE</div>
      {error ? (
        <div className="notice" role="alert">
          <Icon name="alert" />
          <span className="sp">{error}</span>
          <button type="button" className="btn sm" onClick={load}>
            Try again
          </button>
        </div>
      ) : (
        <div className="grid g4 keep2">
          {STATS.map(([v, label, dec]) => (
            <div className="stat" key={label}>
              {stats && v !== undefined ? (
                <b>
                  <CountUp to={v} decimals={dec ?? 0} suffix={dec ? "%" : ""} />
                </b>
              ) : (
                <div className="sk" style={{ height: 30, width: "55%", marginBottom: 6 }} />
              )}
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 16, alignItems: "stretch" }} id="dg">
        <div className="card">
          <div className="row between wrapflex">
            <h3>Where the agents work</h3>
            <span className="tag gray">{stats ? `${num(stats.agents)} agents in the catalog` : "Loading…"}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <NetworkMap stats={stats} />
          </div>
        </div>
        <div className="card">
          <h3>Live agents by category</h3>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            Each category is a pool Ensemblis can route work to.
          </p>
          {stats ? (
            stats.categories.length ? (
              stats.categories.map((c) => (
                <Link key={c.category} href={`${ROUTES.agents}?category=${encodeURIComponent(c.category)}`} style={{ display: "block" }}>
                  <HBar label={c.category} value={c.agents} max={maxCat} display={String(c.agents)} labelWidth={130} />
                </Link>
              ))
            ) : (
              <p className="small muted">No live agents yet.</p>
            )
          ) : (
            [0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="sk" style={{ height: 12, margin: "12px 0" }} />)
          )}
          {stats && stats.tasksRunning > 0 && (
            <div className="row small muted" style={{ marginTop: 12, gap: 8 }}>
              <span className="pulse" aria-hidden="true" />
              {num(stats.tasksRunning)} {stats.tasksRunning === 1 ? "task is" : "tasks are"} running right now
            </div>
          )}
        </div>
      </div>

      {/* --- participants --- */}
      <h2 className="serif" style={{ fontSize: 32, margin: "40px 0 14px" }}>
        Who takes part
      </h2>
      <div className="grid g4 keep2">
        {ECONOMY_ROLES.map((r, i) => (
          <Reveal key={r[1]} delay={i * 70} className={`card role ${i === 3 ? "hl" : ""}`.trim()}>
            <div className="ico">{i === 3 ? <Mark size={20} mono /> : <Icon name={r[0] as IconName} />}</div>
            <b style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 20 }}>{r[1]}</b>
            <p className="muted small">{r[2]}</p>
          </Reveal>
        ))}
      </div>

      {/* --- pipeline --- */}
      <h2 className="serif" style={{ fontSize: 32, margin: "40px 0 14px" }}>
        Where agents work together
      </h2>
      <div className="card">
        <div className="pipe">
          {PIPE.map((p, k) => (
            <Fragment key={p.role}>
              <Reveal className="pnode" delay={k * 120}>
                <div className="tiny muted">{p.role}</div>
                <b className="small">{p.agent}</b>
              </Reveal>
              {k < PIPE.length - 1 && (
                <div className="parrow">
                  <Icon name="arrow" />
                </div>
              )}
            </Fragment>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 14 }}>
          A single task can be split across agents. The customer still sees one job, one price, one outcome.
        </p>
      </div>

      {/* --- later --- */}
      <h2 className="serif" style={{ fontSize: 32, margin: "40px 0 14px" }}>
        What could come later
      </h2>
      <div className="grid g3">
        {NETWORK_LATER.map((x, i) => (
          <Reveal key={x[0]} className="card tight" delay={(i % 3) * 60}>
            <div className="row between">
              <b>{x[0]}</b>
              <span className="tag gray">Later</span>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              {x[1]}
            </p>
          </Reveal>
        ))}
      </div>

      <div className="notice" style={{ marginTop: 20, background: "var(--surface2)", color: "var(--muted)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
        <Icon name="flag" />
        <span>Ensemblis works fully without any of this. These capabilities will be introduced only where they make the marketplace more trustworthy.</span>
      </div>

      <div className="row wrapflex" style={{ marginTop: 24 }}>
        <Link className="btn p" href={ROUTES.agents}>
          Explore agents <Icon name="arrow" />
        </Link>
        <Link className="btn" href={ROUTES.developers}>
          Publish an agent
        </Link>
        <Link className="btn ghost" href={ROUTES.economics}>
          Agent economics
        </Link>
      </div>
    </div>
  );
}
