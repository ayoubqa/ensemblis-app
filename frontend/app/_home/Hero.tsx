"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { CharCount, Icon, Kbd } from "@/components";
import { useConfig } from "@/lib/config";
import { api, type PlatformStats, type TaskEstimate } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DEMO2, EXAMPLES, EX_FULL, HERO, TICKER } from "@/lib/data";
import { eur, minutesRange, num } from "@/lib/format";
import { useDebounced, useReducedMotion } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { DemoPanel } from "./Orch";

const PLACEHOLDERS = [HERO.placeholder, ...Object.values(EX_FULL)];

export function newTaskHref(text: string) {
  const q = text.trim();
  return q ? `${ROUTES.newTask}?q=${encodeURIComponent(q)}` : ROUTES.newTask;
}

// ------------------------------------------------------------- route hint
type HintState =
  | { kind: "empty" }
  | { kind: "short" }
  | { kind: "loading"; prev: TaskEstimate | null }
  | { kind: "ok"; est: TaskEstimate }
  | { kind: "error"; message: string };

function useRouteHint(text: string) {
  const debounced = useDebounced(text.trim(), 500);
  const [state, setState] = useState<HintState>({ kind: "empty" });
  const last = useRef<TaskEstimate | null>(null);
  const cache = useRef(new Map<string, HintState>());
  const reqId = useRef(0);
  const current = useRef(text.trim());
  current.current = text.trim();

  useEffect(() => {
    const t = text.trim();
    if (!t) setState({ kind: "empty" });
    else if (t.length < 12) setState({ kind: "short" });
    else setState(cache.current.get(t) || { kind: "loading", prev: last.current });
  }, [text]);

  useEffect(() => {
    if (debounced.length < 12) return;
    const hit = cache.current.get(debounced);
    if (hit) {
      setState(hit);
      return;
    }
    const id = ++reqId.current;
    api
      .estimateTask({ description: debounced })
      .then(({ estimate }) => {
        last.current = estimate;
        const s: HintState = { kind: "ok", est: estimate };
        cache.current.set(debounced, s);
        if (id === reqId.current && current.current === debounced) setState(s);
      })
      .catch((e: Error) => {
        const s: HintState = { kind: "error", message: e.message };
        cache.current.set(debounced, s);
        if (id === reqId.current && current.current === debounced) setState(s);
      });
  }, [debounced]);

  return state;
}

function RouteHint({ state }: { state: HintState }) {
  if (state.kind === "empty" || state.kind === "short")
    return (
      <>
        <span className="pulse" aria-hidden="true" />
        <span>{state.kind === "empty" ? HERO.emptyHint : "Keep going — a sentence is enough for Ensemblis to plan it."}</span>
      </>
    );
  if (state.kind === "error")
    return (
      <>
        <Icon name="info" />
        <span title={state.message}>Couldn&apos;t preview the routing right now — you can still continue.</span>
      </>
    );
  const est = state.kind === "ok" ? state.est : state.prev;
  if (!est)
    return (
      <>
        <span className="spin" aria-hidden="true" />
        <span>Reading your brief…</span>
      </>
    );
  return (
    <>
      {state.kind === "loading" ? <span className="spin" aria-hidden="true" /> : <span className="pulse" aria-hidden="true" />}
      <span style={{ opacity: state.kind === "loading" ? 0.6 : 1, transition: "opacity .2s" }}>
        Routing to <b>{est.leadAgent.name}</b> · <b>{eur(est.costCents)}</b> · {minutesRange(est.estMinutesLow, est.estMinutesHigh)}
        {est.team.length > 1 && <span className="hideS"> · team of {est.team.length}</span>}
      </span>
    </>
  );
}

// ------------------------------------------------------------- ticker
function Ticker({ stats }: { stats: PlatformStats | null }) {
  const reduced = useReducedMotion();
  const sampleCatalog = useConfig().config.sampleCatalogStats;
  const items = useMemo(() => {
    const sample = TICKER.map((t) => ({ key: t.who, live: false, node: (
      <>
        {t.who} just received {t.what} <span className="muted">· {t.ago}</span>
      </>
    ) }));
    if (!stats) return sample;
    const live = {
      key: "live",
      live: true,
      node: (
        <>
          <b style={{ color: "var(--ink)" }}>{num(stats.tasksRunning)}</b> {stats.tasksRunning === 1 ? "task" : "tasks"} running right now ·{" "}
          {sampleCatalog ? (
            <>
              <b style={{ color: "var(--ink)" }}>{num(stats.realTasksCompleted ?? 0)}</b> delivered on this demo so far
            </>
          ) : (
            <>
              <b style={{ color: "var(--ink)" }}>{num(stats.tasksCompleted)}</b> delivered across {num(stats.liveAgents)} live agents
            </>
          )}
        </>
      ),
    };
    // Real numbers lead, and come back every few items.
    const out = [live];
    sample.forEach((s, i) => {
      out.push(s);
      if (i % 3 === 2) out.push({ ...live, key: `live${i}` });
    });
    return out;
  }, [stats, sampleCatalog]);

  const [i, setI] = useState(0);
  const [vis, setVis] = useState(true);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setI(0);
  }, [items]);
  useEffect(() => {
    if (paused) return;
    let t2: ReturnType<typeof setTimeout>;
    const t = setInterval(() => {
      if (reduced) {
        setI((x) => (x + 1) % items.length);
        return;
      }
      setVis(false);
      t2 = setTimeout(() => {
        setI((x) => (x + 1) % items.length);
        setVis(true);
      }, 260);
    }, 4200);
    return () => {
      clearInterval(t);
      clearTimeout(t2);
    };
  }, [items, paused, reduced]);
  const cur = items[i % items.length];

  return (
    <div className="ticker-wrap" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <span className="pulse" style={{ width: 6, height: 6, flex: "none" }} aria-hidden="true" />
      <span
        style={{
          opacity: vis ? 1 : 0,
          transform: vis ? "none" : "translateY(-4px)",
          transition: "opacity .26s, transform .26s",
          minWidth: 0,
        }}
      >
        {cur.node}
      </span>
      {!cur.live && (
        <span className="tiny" style={{ opacity: 0.6, flex: "none" }} title="Illustrative examples of the work Ensemblis delivers">
          · sample
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------- hero
export const Hero = forwardRef<HTMLTextAreaElement, { stats: PlatformStats | null; draft: string; setDraft: (s: string) => void }>(
  function Hero({ stats, draft, setDraft }, taRef) {
    const router = useRouter();
    const { user, loading } = useAuth();
    const hint = useRouteHint(draft);
    const [demoRun, setDemoRun] = useState(0);
    const [demoTask, setDemoTask] = useState("");
    const [focused, setFocused] = useState(false);
    const [ph, setPh] = useState(0);
    const reduced = useReducedMotion();
    const maxLen = useConfig().config.maxDescriptionLength;

    // Rotate the placeholder through real example briefs while the box is idle.
    useEffect(() => {
      if (draft || focused || reduced) return;
      const t = setInterval(() => setPh((p) => (p + 1) % PLACEHOLDERS.length), 3800);
      return () => clearInterval(t);
    }, [draft, focused, reduced]);

    const est = hint.kind === "ok" ? hint.est : hint.kind === "loading" ? hint.prev : null;

    const submit = () => router.push(newTaskHref((draft || DEMO2).slice(0, maxLen)));
    const preview = () => {
      const text = draft.trim() || DEMO2;
      if (!draft.trim()) setDraft(text);
      setDemoTask(text);
      setDemoRun((r) => r + 1);
    };
    const reset = () => {
      setDemoRun(0);
      setDraft("");
      const ta = typeof taRef === "object" ? taRef?.current : null;
      ta?.focus();
    };

    const demoAgents = useMemo<[string, string][] | undefined>(() => {
      if (!est) return undefined;
      const work = est.team.filter((m) => !/verif/i.test(m.role));
      return work.slice(0, 4).map((m) => [m.agentName, m.title] as [string, string]);
    }, [est]);
    const demoVer = useMemo<[string, string] | undefined>(() => {
      const v = est?.team.find((m) => /verif/i.test(m.role));
      return v ? [v.agentName, v.title] : undefined;
    }, [est]);

    const dash = user?.accountType === "DEVELOPER" ? ROUTES.devDashboard : ROUTES.dashboard;
    const d = (ms: number) => ({ animationDelay: `${ms}ms` });

    return (
      <section className="dk hero-dk" aria-labelledby="hero-title">
        <div className="wrap hx">
          <div className="hx-badge reveal" style={d(0)}>
            <span className="pulse" aria-hidden="true" />
            {HERO.badge}
            {stats && stats.liveAgents > 0 && (
              <span className="hideS" style={{ color: "var(--ink)", fontWeight: 600 }}>
                · {num(stats.liveAgents)} agents live
              </span>
            )}
          </div>
          <h1 id="hero-title" className="reveal" style={d(70)}>
            AI agents that{" "}
            <span
              style={{
                background: "linear-gradient(92deg, var(--ink) 10%, var(--accent) 55%, var(--cyan))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              do the work.
            </span>
          </h1>
          <p className="sub reveal" style={d(140)}>
            {HERO.sub}
          </p>
          <div className="row wrapflex reveal" style={{ gap: 10, marginTop: 26, ...d(210) }}>
            {!loading && user ? (
              <>
                <Link className="btn p lg" href={dash}>
                  Go to dashboard <Icon name="arrow" />
                </Link>
                <Link className="btn lg" href={ROUTES.newTask}>
                  <Icon name="plus" />
                  New task
                </Link>
              </>
            ) : (
              <>
                <Link className="btn p lg" href={ROUTES.newTask}>
                  Get work done
                </Link>
                <Link className="btn lg" href={ROUTES.agents}>
                  Explore agents
                </Link>
              </>
            )}
          </div>

          <form
            className="brief reveal"
            style={{ maxWidth: 860, ...d(280) }}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="draft">{user ? `What do you need done, ${user.name.split(" ")[0]}?` : "What do you need done?"}</label>
            <textarea
              id="draft"
              ref={taRef}
              rows={3}
              value={draft}
              placeholder={PLACEHOLDERS[ph]}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              aria-describedby="route hero-count"
              maxLength={maxLen}
            />
            <div className="foot">
              <div className="route" id="route" aria-live="polite">
                <RouteHint state={hint} />
              </div>
              <button type="button" className="btn lg ghost" onClick={preview} title="Watch how Ensemblis would orchestrate this">
                <Icon name="play" size={14} />
                Preview
              </button>
              <button type="submit" className="btn p lg">
                Get it done <Icon name="arrow" />
              </button>
            </div>
          </form>
          <div className="reveal" style={{ maxWidth: 860, textAlign: "right", marginTop: 6, ...d(300) }}>
            <CharCount id="hero-count" value={draft} max={maxLen} />
          </div>
          <div className="examples reveal" style={{ maxWidth: 860, ...d(350) }} aria-label="Example tasks">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                className={`chip ${draft === EX_FULL[e] ? "on" : ""}`.trim()}
                aria-pressed={draft === EX_FULL[e]}
                onClick={() => {
                  setDraft(EX_FULL[e] || e);
                  const ta = typeof taRef === "object" ? taRef?.current : null;
                  ta?.focus({ preventScroll: true });
                }}
              >
                {e}
              </button>
            ))}
            <span className="tiny muted hideM" style={{ alignSelf: "center", marginLeft: 4 }}>
              <Kbd>Ctrl/⌘</Kbd> <Kbd>Enter</Kbd> to continue
            </span>
          </div>
          <div className="reveal" style={d(420)}>
            <Ticker stats={stats} />
          </div>
          <div className="small muted reveal" style={{ marginTop: 10, maxWidth: 860, display: "flex", gap: 7, alignItems: "flex-start", ...d(470) }}>
            <Icon name="lock" />
            <span>{HERO.privacy}</span>
          </div>
          {demoRun > 0 && (
            <div style={{ maxWidth: 860 }}>
              <DemoPanel
                runId={demoRun}
                task={demoTask}
                agents={demoAgents}
                ver={demoVer}
                summary={est ? `${est.title} · ${est.team.length} agents · ${eur(est.costCents)} when you run it` : undefined}
                onRun={() => router.push(newTaskHref(demoTask))}
                onReset={reset}
              />
            </div>
          )}
        </div>
      </section>
    );
  }
);
