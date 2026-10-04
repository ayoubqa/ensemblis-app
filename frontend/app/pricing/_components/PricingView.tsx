"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon, useShell } from "@/components";
import { api, type Agent, type TaskEstimate } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CATS7, DEMO2, PRICING_FAQS, PRICING_PLANS, STARTING_CREDITS_CENTS, catGroup } from "@/lib/data";
import { eur, minutesRange } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";

function PriceRanges() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listAgents()
      .then((r) => setAgents(r.agents.filter((a) => a.isLive)))
      .catch((e: Error) => setError(e.message));
  }, []);

  const rows = useMemo(() => {
    if (!agents) return [];
    const by = new Map<string, { lo: number; hi: number; n: number }>();
    agents.forEach((a) => {
      const g = catGroup(a.category);
      const cur = by.get(g) || { lo: Infinity, hi: 0, n: 0 };
      cur.lo = Math.min(cur.lo, a.priceFromCents || a.pricePerTaskCents);
      cur.hi = Math.max(cur.hi, a.pricePerTaskCents);
      cur.n++;
      by.set(g, cur);
    });
    const order = [...CATS7, ...[...by.keys()].filter((k) => !(CATS7 as readonly string[]).includes(k))];
    return order.filter((g) => by.has(g)).map((g) => ({ g, ...by.get(g)! }));
  }, [agents]);
  const max = Math.max(1, ...rows.map((r) => r.hi));

  if (error)
    return (
      <div className="notice" role="alert">
        <Icon name="alert" />
        <span>{error}</span>
      </div>
    );
  if (!agents)
    return (
      <div aria-busy="true">
        {[0, 1, 2, 3, 4].map((k) => (
          <div className="sk" key={k} style={{ height: 14, margin: "12px 0" }} />
        ))}
      </div>
    );
  if (!rows.length) return <p className="small muted">No live agents yet.</p>;
  return (
    <div>
      {rows.map((r) => (
        <div className="rrow" key={r.g}>
          <Link href={`${ROUTES.agents}?category=${encodeURIComponent(r.g)}`} style={{ fontWeight: 600 }}>
            {r.g} <span className="tiny muted">· {r.n}</span>
          </Link>
          <div className="rng" role="img" aria-label={`${r.g}: ${eur(r.lo)} to ${eur(r.hi)} per task`}>
            <i style={{ left: `${(r.lo / max) * 100}%`, width: `${Math.max(2, ((r.hi - r.lo) / max) * 100)}%` }} />
          </div>
          <span style={{ textAlign: "right" }}>
            {r.lo === r.hi ? eur(r.lo) : `${eur(r.lo)}–${eur(r.hi)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function QuoteBox() {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 500);
  const [est, setEst] = useState<TaskEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.length < 12) {
      setEst(null);
      setError(null);
      return;
    }
    let live = true;
    setBusy(true);
    api
      .estimateTask({ description: q })
      .then((r) => live && (setEst(r.estimate), setError(null)))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [q]);

  return (
    <div className="card">
      <div className="row between wrapflex">
        <h3>What would my task cost?</h3>
        <span className="tag">Live quote</span>
      </div>
      <p className="small muted" style={{ margin: "4px 0 12px" }}>
        Describe a task — Ensemblis plans it and quotes a fixed price before anything runs. Nothing is charged here.
      </p>
      <label className="l" htmlFor="quote">
        Task
      </label>
      <textarea id="quote" className="f" rows={2} value={text} placeholder={DEMO2} onChange={(e) => setText(e.target.value)} />
      {!text && (
        <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => setText(DEMO2)}>
          Use an example
        </button>
      )}
      <div aria-live="polite" style={{ marginTop: 14, minHeight: 64 }}>
        {error ? (
          <div className="notice">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        ) : est ? (
          <div className="grid g3 keep2" style={{ opacity: busy ? 0.6 : 1, transition: "opacity .2s" }}>
            <div className="stat">
              <b>{eur(est.costCents)}</b>
              <span>fixed price</span>
            </div>
            <div className="stat">
              <b>{minutesRange(est.estMinutesLow, est.estMinutesHigh)}</b>
              <span>estimated time</span>
            </div>
            <div className="stat">
              <b>~{est.manualHoursEstimate}h</b>
              <span>by hand</span>
            </div>
            <div className="small muted" style={{ gridColumn: "1 / -1" }}>
              Led by <b style={{ color: "var(--ink)" }}>{est.leadAgent.name}</b> with a team of {est.team.length} ·{" "}
              <Link href={`${ROUTES.newTask}?q=${encodeURIComponent(text.trim())}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
                Run it <Icon name="arrow" size={13} />
              </Link>
            </div>
          </div>
        ) : busy ? (
          <div className="row small muted">
            <span className="spin" aria-hidden="true" /> Planning your task…
          </div>
        ) : (
          <p className="small muted">{text.trim().length > 0 ? "Keep going — a sentence is enough." : "Your quote appears here."}</p>
        )}
      </div>
    </div>
  );
}

export function PricingView() {
  const { user } = useAuth();
  const { openRoleSelect } = useShell();

  const planCta = (i: number, label: string, hl?: boolean) => {
    const cls = `btn ${hl ? "p" : ""} lg`;
    if (!user)
      return (
        <button type="button" className={cls} style={{ width: "100%" }} onClick={() => openRoleSelect({ role: "company" })}>
          {label}
        </button>
      );
    const href = i === 0 ? ROUTES.newTask : ROUTES.billing;
    return (
      <Link className={cls} style={{ width: "100%" }} href={href}>
        {i === 0 ? "Start a task" : "Manage billing"}
      </Link>
    );
  };

  return (
    <div className="wrap">
      <div className="pagehead" style={{ textAlign: "center" }}>
        <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
          PRICING
        </div>
        <h1>Simple, usage-based pricing.</h1>
        <p style={{ maxWidth: "48ch", margin: "8px auto 0" }}>Pay for outcomes, not seats. Add team features as you grow.</p>
      </div>
      <div className="grid g3" style={{ alignItems: "stretch", marginTop: 10 }}>
        {PRICING_PLANS.map((p, i) => (
          <div
            key={p.name}
            className="card reveal"
            style={{ display: "flex", flexDirection: "column", animationDelay: `${i * 80}ms`, ...(p.highlight ? { borderColor: "var(--accent)", boxShadow: "var(--shadow)" } : null) }}
          >
            {p.highlight && (
              <span className="tag" style={{ background: "var(--accent)", color: "var(--accent-ink)", alignSelf: "flex-start", marginBottom: 10 }}>
                Most popular
              </span>
            )}
            <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>{p.name}</h3>
            <div style={{ margin: "10px 0" }}>
              <b style={{ fontSize: 34 }}>{p.price}</b>
              <span className="muted small">{p.sub}</span>
            </div>
            <p className="small muted">{p.desc}</p>
            <div className="stack" style={{ margin: "14px 0", flex: 1 }}>
              {p.features.map((f) => (
                <div key={f} className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--accent)", marginTop: 2 }}>
                    <Icon name="check" />
                  </span>
                  {f}
                </div>
              ))}
            </div>
            {planCta(i, p.cta, p.highlight)}
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ textAlign: "center", marginTop: 12 }}>
        Every new account starts with {eur(STARTING_CREDITS_CENTS)} in demo credits. This is a demo environment — no real payments are taken.
      </p>

      <div className="grid g2" style={{ marginTop: 40, alignItems: "start" }}>
        <QuoteBox />
        <div className="card">
          <div className="row between wrapflex">
            <h3>What tasks cost today</h3>
            <span className="tag gray">From live agents</span>
          </div>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            Per-task price ranges across the marketplace, by kind of work. Deep runs cost more; focused runs less.
          </p>
          <PriceRanges />
        </div>
      </div>

      <div className="eyebrow" style={{ margin: "40px 0 10px" }}>
        FREQUENTLY ASKED QUESTIONS
      </div>
      <div className="grid g2" style={{ marginBottom: 40 }}>
        {PRICING_FAQS.map((f) => (
          <div key={f[0]} className="card tight">
            <b className="small">{f[0]}</b>
            <p className="small muted" style={{ marginTop: 6 }}>
              {f[1]}
            </p>
          </div>
        ))}
      </div>
      <div className="cta-band" style={{ textAlign: "center", padding: "50px 0" }}>
        <h2 style={{ margin: "0 auto 16px", maxWidth: "none" }}>Ready to get work done?</h2>
        {user ? (
          <Link className="btn p lg" href={ROUTES.newTask}>
            Start a new task
          </Link>
        ) : (
          <button type="button" className="btn p lg" onClick={() => openRoleSelect()}>
            Get started free
          </button>
        )}
      </div>
    </div>
  );
}
