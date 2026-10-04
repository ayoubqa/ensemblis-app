"use client";

import { CSSProperties, ReactNode, useState } from "react";
import {
  Avatar,
  AvatarStack,
  ChipGroup,
  CountUp,
  EmptyState,
  Flow,
  HBar,
  Icon,
  ICONS,
  KV,
  LineChart,
  Lockup,
  Mark,
  Meter,
  Modal,
  OutcomeTag,
  PageHead,
  PerfGraph,
  ProgressBar,
  Rating,
  Reveal,
  Skeleton,
  SkeletonCard,
  SkeletonText,
  Sparkline,
  Stars,
  Stat,
  StatusTag,
  StepStatusTag,
  Tabs,
  Tag,
  ThemeSwitch,
  VerifiedTag,
  confetti,
  useShell,
  useToast,
  type IconName,
} from "@/components";
import { ENSEMBLE, HOW_IT_WORKS, PERF_GRAPH, PIPE, STAGES, TODAY_CHAIN } from "@/lib/data";
import { duration, eur, relativeTime } from "@/lib/format";
import { seeded } from "@/lib/utils";

const TOKENS = ["--bg", "--surface", "--surface2", "--ink", "--muted", "--line", "--line2", "--accent", "--accent-ink", "--accent-soft", "--cyan", "--ok", "--ok-soft", "--warn", "--warn-soft", "--bad", "--bad-soft"];

const NAV = [
  ["tokens", "Tokens"],
  ["type", "Type"],
  ["buttons", "Buttons"],
  ["tags", "Tags & chips"],
  ["forms", "Forms"],
  ["cards", "Cards"],
  ["data", "Data"],
  ["charts", "Charts"],
  ["nav", "Navigation"],
  ["orch", "Orchestration"],
  ["feedback", "Feedback"],
  ["loading", "Loading"],
  ["icons", "Icons"],
  ["dark", "Dark sections"],
] as const;

function Sec({ id, title, sub, children }: { id: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="sg-sec" id={id} aria-labelledby={`h-${id}`}>
      <h2 id={`h-${id}`}>{title}</h2>
      {sub ? <p className="small muted">{sub}</p> : <div style={{ height: 12 }} />}
      {children}
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="sg-code">{children}</code>;
}

function Orch({ loop = true, stage = 0, done = false }: { loop?: boolean; stage?: number; done?: boolean }) {
  const st = stage;
  const aS = loop ? "" : st < 2 ? "q" : st === 2 ? "m" : st === 3 ? "w" : "d";
  const vS = loop ? "" : st < 4 ? "q" : st === 4 ? "w" : "d";
  const oS = loop ? "" : done ? "d" : "q";
  const L: Record<string, string> = { q: "Queued", m: "Matched", w: "Working", d: "Done" };
  const node = (n: string, d: string, x: string) => (
    <div key={n} className={`node ${x}`}>
      <div className="row between">
        <b>{n}</b>
        {x === "d" ? <Icon name="check" /> : x === "w" ? <span className="pulse" /> : null}
      </div>
      <div className="tiny muted">{d}</div>
      {x === "w" && (
        <div className="pb">
          <i />
        </div>
      )}
      {!loop && <div className="tiny st">{L[x]}</div>}
    </div>
  );
  return (
    <div className={loop ? "orch loop" : "orch"}>
      <div className="node">
        <div className="tiny muted">Task</div>
        <div className="small" style={{ fontWeight: 600 }}>
          {ENSEMBLE.task}
        </div>
      </div>
      <div className={`conn ${loop || st >= 1 ? "act" : ""}`} />
      <div className="agents">{ENSEMBLE.agents.map(([n, d]) => node(n, d, aS))}</div>
      <div className={`conn ${loop || st >= 3 ? "act" : ""}`} />
      {!loop && (
        <>
          {node("Verification Agent", "Checks sources and requirements", vS)}
          <div className={`conn ${st >= 4 ? "act" : ""}`} />
        </>
      )}
      <div className={`node out ${oS}`}>
        <div className="row between">
          <b>{ENSEMBLE.out}</b>
          {oS === "d" && <Icon name="check" />}
        </div>
        <div className="tiny muted">{ENSEMBLE.outDesc}</div>
      </div>
    </div>
  );
}

export function Styleguide() {
  const toast = useToast();
  const shell = useShell();
  const [modal, setModal] = useState<null | "basic" | "wide" | "confirm">(null);
  const [tab, setTab] = useState("Overview");
  const [chip, setChip] = useState("All");
  const [stars, setStars] = useState(4);
  const [flow, setFlow] = useState(2);
  const [how, setHow] = useState(0);
  const [stage, setStage] = useState(3);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState("standard");
  const series = seeded(5, 12, 60, 80).map(Math.round);
  const now = Date.now();

  return (
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <PageHead
        eyebrow="STYLE GUIDE"
        title="Ensemblis design system"
        sub="Every shared component and core prototype class, rendered live. Toggle the theme to check both modes. See FRONTEND_GUIDE.md for props and usage."
        actions={<ThemeSwitch />}
      />
      <nav className="row wrapflex" style={{ gap: 6, marginBottom: 8 }} aria-label="Style guide sections">
        {NAV.map(([id, l]) => (
          <a key={id} href={`#${id}`} className="chip">
            {l}
          </a>
        ))}
      </nav>

      {/* ---------------------------------------------------------- tokens */}
      <Sec id="tokens" title="Brand & tokens" sub={<>Colors are CSS variables on <Code>:root</Code>; dark values apply under <Code>[data-theme=&quot;dark&quot;]</Code> and inside <Code>.dk</Code>.</>}>
        <div className="grid g3">
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="bcell">
              <Lockup size={40} />
            </div>
            <div className="tiny muted" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
              <Code>{"<Lockup size={40} />"}</Code>
            </div>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="bcell dk">
              <Lockup size={40} />
            </div>
            <div className="tiny muted" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
              Inside <Code>.dk</Code>
            </div>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="bcell">
              <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
                <Mark size={40} />
                <span style={{ color: "var(--ink)" }}>
                  <Mark size={40} mono />
                </span>
                <div className="dk" style={{ width: 48, height: 48, borderRadius: 12, display: "grid", placeItems: "center" }}>
                  <Mark size={28} />
                </div>
              </div>
            </div>
            <div className="tiny muted" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
              <Code>{"<Mark size mono? />"}</Code>
            </div>
          </div>
        </div>
        <div className="grid g6 keep2" style={{ marginTop: 16 }}>
          {TOKENS.map((t) => (
            <div key={t}>
              <div className="sw" style={{ background: `var(${t})` }} />
              <b className="tiny">{t}</b>
            </div>
          ))}
        </div>
      </Sec>

      {/* ---------------------------------------------------------- type */}
      <Sec id="type" title="Typography" sub="Sora (var(--serif)) for display, Manrope (var(--sans)) for interface.">
        <div className="stack">
          <div className="hx">
            <h1 style={{ margin: 0, fontSize: "clamp(36px,5vw,56px)" }}>AI agents that do the work.</h1>
            <div className="tiny muted">
              <Code>.hx h1</Code> (hero, 42–86px)
            </div>
          </div>
          <div>
            <div className="newh">What do you need done?</div>
            <div className="tiny muted">
              <Code>.newh</Code>
            </div>
          </div>
          <div className="pagehead" style={{ padding: 0 }}>
            <h1>Task history</h1>
            <p>Everything you&apos;ve asked for, with results, cost and outcomes.</p>
            <div className="tiny muted">
              <Code>.pagehead h1 / p</Code> — or <Code>{"<PageHead />"}</Code>
            </div>
          </div>
          <div className="sect" style={{ padding: 0 }}>
            <h2>How Ensemblis works</h2>
            <div className="tiny muted">
              <Code>.sect h2</Code>
            </div>
          </div>
          <div>
            <div className="eyebrow">ACTIVE WORK</div>
            <p>
              Body 15px. <span className="muted">.muted</span> · <span className="small">.small 13px</span> · <span className="tiny">.tiny 12px</span> ·{" "}
              <span className="serif" style={{ fontSize: 20 }}>
                .serif
              </span>
            </p>
          </div>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- buttons */}
      <Sec id="buttons" title="Buttons" sub={<><Code>.btn</Code> + modifiers <Code>.p .lg .sm .bad .ghost .block</Code>; <Code>aria-busy</Code> shows a spinner; <Code>.ibtn</Code> for icon buttons.</>}>
        <div className="row wrapflex">
          <button className="btn p lg">
            Get it done <Icon name="arrow" />
          </button>
          <button className="btn lg">Explore agents</button>
          <button className="btn p">
            <Icon name="plus" />
            New task
          </button>
          <button className="btn">
            <Icon name="dl" />
            Download PDF
          </button>
          <button className="btn sm">View agent</button>
          <button className="btn p sm">Run now</button>
          <button className="btn bad sm">Delete</button>
          <button className="btn ghost sm">Ghost</button>
          <button className="btn" disabled>
            Disabled
          </button>
          <button
            className="btn p"
            aria-busy={busy}
            onClick={() => {
              setBusy(true);
              setTimeout(() => setBusy(false), 1500);
            }}
          >
            Click to load
          </button>
          <button className="ibtn" aria-label="Notifications">
            <Icon name="bell" />
            <span className="dot" />
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="askbar" type="button">
            <span className="ph">What do you need done?</span>
            <span className="btn p">
              <Icon name="plus" />
              New task
            </span>
          </button>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            <Code>.askbar</Code>
          </div>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- tags */}
      <Sec id="tags" title="Tags, chips & badges">
        <div className="stack">
          <div className="row wrapflex">
            <Tag>Default</Tag>
            <Tag variant="ok" icon="check">
              ok
            </Tag>
            <Tag variant="warn">warn</Tag>
            <Tag variant="bad">bad</Tag>
            <Tag variant="gray">gray</Tag>
            <VerifiedTag verified />
            <VerifiedTag verified={false} />
            <VerifiedTag verified compact />
          </div>
          <div className="row wrapflex">
            <StatusTag status="PLANNING" />
            <StatusTag status="RUNNING" />
            <StatusTag status="COMPLETED" />
            <StatusTag status="FAILED" />
            <StatusTag status="REFUNDED" />
            <span className="muted small">·</span>
            <StepStatusTag status="QUEUED" />
            <StepStatusTag status="RUNNING" />
            <StepStatusTag status="COMPLETED" />
            <StepStatusTag status="FAILED" />
            <span className="muted small">·</span>
            <OutcomeTag outcome="Achieved" />
            <OutcomeTag outcome="Partially" />
            <OutcomeTag outcome="Not achieved" />
          </div>
          <ChipGroup options={["All", "Active", "Completed", "Failed"]} value={chip} onChange={setChip} />
          <div className="row wrapflex">
            <span className="chip">Web research</span>
            <span className="chip">
              <Icon name="check" />
              Market research
            </span>
            <span className="credpill">
              <Icon name="eur" size={14} />
              {eur(10000)} demo credits
            </span>
            <span className="demob">
              <Icon name="spark" />
              Never charged
            </span>
            <span className="hx-badge">
              <span className="pulse" />
              The marketplace for AI work
            </span>
            <kbd className="kbd">⌘K</kbd>
            <span className="srcchip">
              <Icon name="link" />
              Company website
            </span>
            <Rating value={4.8} />
            <Rating value={4.6} outOf />
          </div>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- forms */}
      <Sec id="forms" title="Forms" sub={<><Code>label.l</Code> + <Code>input.f / textarea.f / select.f</Code> + <Code>.hint</Code> / <Code>.err</Code>.</>}>
        <div className="grid g2">
          <div className="stack">
            <div>
              <label className="l" htmlFor="sg-name">
                Full name
              </label>
              <input id="sg-name" className="f" placeholder="Alex Morgan" />
              <div className="hint">As shown to your team.</div>
            </div>
            <div>
              <label className="l" htmlFor="sg-email">
                Email
              </label>
              <input id="sg-email" className="f" defaultValue="not-an-email" aria-invalid="true" />
              <div className="err">Enter a valid email address.</div>
            </div>
            <div>
              <label className="l" htmlFor="sg-freq">
                Frequency
              </label>
              <select id="sg-freq" className="f" defaultValue="Monthly">
                <option>Weekly</option>
                <option>Monthly</option>
                <option>Quarterly</option>
              </select>
            </div>
          </div>
          <div className="stack">
            <div className="brief" style={{ marginTop: 0 }}>
              <label htmlFor="sg-brief">What do you need done?</label>
              <textarea id="sg-brief" rows={3} placeholder="Analyze the top 20 competitors in the European data center cooling market..." />
              <div className="foot">
                <div className="route">
                  <span className="pulse" />
                  <span>
                    Ensemblis will treat this as <b>Competitive Intelligence</b> · about <b>€25</b> · 8–12 min
                  </span>
                </div>
                <button className="btn p">
                  Get it done <Icon name="arrow" />
                </button>
              </div>
            </div>
            <div className="row wrapflex">
              <label className="chip" style={{ cursor: "pointer" }}>
                <input type="checkbox" defaultChecked /> Fully verified
              </label>
              <label className="row small" style={{ cursor: "pointer", gap: 8 }}>
                <input type="checkbox" /> Weekly summary email
              </label>
            </div>
            <textarea className="f" rows={2} placeholder="Optional: tell us more" />
          </div>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- cards */}
      <Sec id="cards" title="Cards" sub={<><Code>.card</Code> (<Code>.tight .flat</Code>), <Code>.acard</Code>, <Code>.catcard</Code>, <Code>.role(.hl)</Code>, <Code>.opt(.sel)</Code>, <Code>.pick</Code>, <Code>.dcard</Code>, <Code>.notice</Code>, <Code>.contrast</Code>, <Code>.mini</Code>, <Code>.mrow</Code>.</>}>
        <div className="grid g3">
          <div className="card acard" tabIndex={0}>
            <div className="row">
              <Avatar name="Competitive Intelligence Agent" hue={172} />
              <div className="sp">
                <b>Competitive Intelligence Agent</b>
                <div className="tiny muted">by DataLabs</div>
              </div>
              <VerifiedTag verified compact />
            </div>
            <p className="small muted" style={{ minHeight: 40 }}>
              Researches companies and markets, compares products, pricing and positioning, and returns a sourced report.
            </p>
            <div className="row wrapflex" style={{ gap: 6 }}>
              {["Competitive research", "Market research", "Company research"].map((c) => (
                <span key={c} className="chip" style={{ padding: "2px 9px", fontSize: 12 }}>
                  {c}
                </span>
              ))}
            </div>
            <div className="stats">
              <span>
                <b>96.8%</b> success
              </span>
              <span>
                <b>2,481</b> tasks
              </span>
              <span>
                <b>8m 42s</b> avg
              </span>
            </div>
            <div className="row between small">
              <span className="muted">
                Typical <b style={{ color: "var(--ink)" }}>{eur(2500)}</b>
              </span>
              <span className="btn sm">View agent</span>
            </div>
          </div>
          <div className="card catcard" tabIndex={0}>
            <h3>Research</h3>
            <p className="small muted">Competitive analyses, market sizing, due diligence</p>
            <div className="row between small" style={{ marginTop: "auto", paddingTop: 10 }}>
              <span className="muted">Sourced report in ~10 min</span>
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                Try it <Icon name="arrow" />
              </span>
            </div>
          </div>
          <div className="stack">
            <div className="card tight">
              <h3>.card.tight</h3>
              <p className="small muted">16px padding.</p>
            </div>
            <div className="card flat">
              <h3>.card.flat</h3>
              <p className="small muted">surface2 background.</p>
            </div>
          </div>
          <div className="card role">
            <div className="ico">
              <Icon name="code" />
            </div>
            <b style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 20 }}>Developers</b>
            <p className="muted small">create intelligence</p>
          </div>
          <div className="card role hl">
            <div className="ico">
              <Icon name="layers" />
            </div>
            <b style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 20 }}>Ensemblis</b>
            <p className="muted small">connects the system</p>
          </div>
          <div className="stack">
            {(["focused", "standard"] as const).map((k) => (
              <button key={k} type="button" className={`card tight opt ${sel === k ? "sel" : ""}`} style={{ width: "100%", textAlign: "left" }} onClick={() => setSel(k)} aria-pressed={sel === k}>
                <div className="row between">
                  <b>{k === "focused" ? "Focused" : "Standard"}</b>
                  <b>{k === "focused" ? "€19" : "€25"}</b>
                </div>
                <div className="tiny muted">{k === "focused" ? "6–9 min · about 28 sources" : "8–12 min · about 47 sources"}</div>
              </button>
            ))}
          </div>
          <div className="card pick">
            <span className="tag">Recommended execution</span>
            <p className="small muted" style={{ marginTop: 10 }}>
              <Code>.pick</Code> — the chosen option.
            </p>
          </div>
          <div className="stack">
            <div className="dcard">
              <div className="row" style={{ gap: 10 }}>
                <div style={{ color: "var(--accent)" }}>
                  <Icon name="eur" />
                </div>
                <div className="sp">
                  <b className="small">€100 in demo credits preloaded</b>
                  <div className="tiny muted">Demo environment · no real charges</div>
                </div>
              </div>
            </div>
            <div className="notice">
              <Icon name="flag" />
              <span>3 of 14 figures had no source.</span>
            </div>
          </div>
          <div className="stack">
            <div className="mini">
              <div className="tiny muted">What do you need done?</div>
              <div style={{ marginTop: 6 }}>
                Analyze the top 20 competitors<span className="caret" />
              </div>
            </div>
            <div className="mrow best">
              <b>Research Agent</b>
              <span>96.8% success · 2,481 tasks</span>
            </div>
            <div className="mrow">
              <b>Data Analysis Agent</b>
              <span>96.0% success</span>
            </div>
          </div>
        </div>
        <div className="grid g3" style={{ marginTop: 16 }}>
          <div className="contrast">
            <div>
              <span className="tiny muted">Traditional software</span>
              <b>Find the right tool.</b>
            </div>
            <div>
              <span className="tiny" style={{ color: "var(--accent)", fontWeight: 600 }}>
                Ensemblis
              </span>
              <b>Describe the work.</b>
            </div>
          </div>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- data */}
      <Sec id="data" title="Data display" sub={<><Code>{"<Stat/>"}</Code> / <Code>.stat</Code>, <Code>{"<CountUp/>"}</Code>, <Code>{"<KV/>"}</Code>, <Code>.tw table</Code>, <Code>{"<HBar/>"}</Code>, <Code>{"<Meter/>"}</Code>, <Code>.split</Code>, <Code>.conf</Code>, <Code>.rrow/.rng</Code>, <Code>.dots</Code>, avatars, stars.</>}>
        <div className="grid g4 keep2">
          <Stat value={<CountUp to={2481} />} label="tasks completed" />
          <Stat value={<CountUp to={96.8} decimals={1} suffix="%" />} label="successful" delta="+2.1%" />
          <Stat value={duration(522)} label="average execution" />
          <Stat value={eur(284000)} label="revenue" />
        </div>
        <div className="grid g2" style={{ marginTop: 16, alignItems: "start" }}>
          <div className="card">
            <h3>Task receipt</h3>
            <KV k="Customer paid">{eur(2500)}</KV>
            <KV k="Agent execution">
              <span>{eur(800)}</span>
            </KV>
            <KV k="Status">
              <Tag variant="ok">Passed</Tag>
            </KV>
            <KV k="Confidence">
              <span className="conf">
                <i className="on" />
                <i className="on" />
                <i className="on" />
                <span>High confidence</span>
              </span>
            </KV>
            <KV k="Completed">
              <span>{relativeTime(now - 2 * 60000)}</span>
            </KV>
          </div>
          <div className="card">
            <h3>Bars & meters</h3>
            <HBar label="Capability fit" value={96} />
            <HBar label="Track record" value={97} />
            <HBar label="Speed" value={89} />
            <div className="row" style={{ gap: 10, marginTop: 12 }}>
              <Meter value={92} width={56} />
              <span className="small">92</span>
              <span className="sp" />
              <span className="dots" aria-label="3 of 5">
                <i className="on" />
                <i className="on" />
                <i className="on" />
                <i />
                <i />
              </span>
            </div>
            <div className="small muted" style={{ margin: "14px 0 6px" }}>
              Example: a €25 task
            </div>
            <div className="split">
              <div style={{ width: "80%", background: "var(--accent)", color: "var(--accent-ink)" }}>Creator €20</div>
              <div style={{ width: "20%", background: "var(--line2)", color: "var(--ink)" }}>€5</div>
            </div>
            <div className="rrow" style={{ marginTop: 10 }}>
              <span>Direct-to-chip</span>
              <div className="rng">
                <i style={{ left: "33%", width: "21%" }} />
              </div>
              <b>€165–270</b>
            </div>
          </div>
        </div>
        <div className="tw" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Date</th>
                <th>Cost</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              <tr className="tr-click">
                <td>
                  <b>European competitor analysis</b>
                </td>
                <td>
                  <StatusTag status="COMPLETED" />
                </td>
                <td>Today</td>
                <td>{eur(2500)}</td>
                <td>
                  <OutcomeTag outcome="Achieved" />
                </td>
              </tr>
              <tr className="tr-click">
                <td>
                  <b>B2B SaaS competitive research</b>
                </td>
                <td>
                  <StatusTag status="RUNNING" />
                </td>
                <td>Today</td>
                <td>{eur(1450)}</td>
                <td>
                  <OutcomeTag outcome={null} />
                </td>
              </tr>
              <tr className="tr-click">
                <td>
                  <b>Board deck: Series A update</b>
                </td>
                <td>
                  <StatusTag status="FAILED" />
                </td>
                <td>Sep 20</td>
                <td>{eur(1800)}</td>
                <td>
                  <OutcomeTag outcome={null} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="row wrapflex" style={{ marginTop: 16, gap: 16 }}>
          <Avatar name="Competitive Intelligence Agent" hue={172} size="lg" />
          <Avatar name="Lead Research Agent" hue={24} />
          <Avatar name="Financial Analyst" hue={210} size="sm" />
          <Avatar name="Alex Morgan" hue={250} size="xs" round />
          <AvatarStack names={["Alex Morgan", "Priya Shah", "Tomás Rivera", "Anna Kowalski"]} />
          <Stars value={stars} onChange={setStars} label="How useful was this work?" />
          <Stars value={4} />
        </div>
      </Sec>

      {/* ---------------------------------------------------------- charts */}
      <Sec id="charts" title="Charts" sub={<><Code>{"<LineChart values height? min? label? xLabels? />"}</Code>, <Code>{"<Sparkline />"}</Code>, <Code>{"<PerfGraph rows />"}</Code>.</>}>
        <div className="grid g2" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="eyebrow">SPENDING</div>
            <b style={{ fontSize: 34, letterSpacing: "-.02em" }}>{eur(8400)}</b>
            <div className="small muted">This month, in demo credits</div>
            <div style={{ marginTop: 8 }}>
              <LineChart values={series} height={100} label="Spending" />
            </div>
          </div>
          <div className="card">
            <h3>Success rate, last 12 weeks</h3>
            <LineChart values={seeded(1, 12, 94.8, 3)} min={92} height={150} label="Success rate history" xLabels={["Jul", "Aug", "Sep", "Oct"]} format={(v) => v.toFixed(1) + "%"} />
            <div className="row" style={{ marginTop: 12, gap: 10 }}>
              <Sparkline values={seeded(3, 10, 20, 12)} />
              <span className="small muted">Sparkline</span>
            </div>
          </div>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row between wrapflex">
            <div>
              <h3>The Agent Performance Graph</h3>
              <p className="small muted">Ensemblis learns which agents perform best for which types of work.</p>
            </div>
            <span className="tag">Live example</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <PerfGraph rows={PERF_GRAPH.map((r) => [r[0], r[1], r[2]])} />
          </div>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- navigation */}
      <Sec id="nav" title="Navigation & steps" sub={<><Code>{"<Tabs/>"}</Code>, <Code>{"<Flow step/>"}</Code>, <Code>.hwtabs</Code>, <Code>.wiz/.wstep</Code>, <Code>.stagebar</Code>, <Code>.chain/.cchip</Code>, <Code>.pipe/.pnode</Code>, <Code>.chk</Code>, <Code>.onb</Code>.</>}>
        <Tabs tabs={["Overview", "Performance", { id: "Examples", label: "Example tasks", count: 4 }, "Pricing", "Reviews"]} value={tab} onChange={setTab} />
        <p className="small muted" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          Panel: {tab}
        </p>
        <div className="row wrapflex" style={{ marginTop: 12 }}>
          <Flow step={flow} />
          <span className="sp" />
          <button className="btn sm" onClick={() => setFlow((f) => (f + 1) % 5)}>
            Next step
          </button>
        </div>
        <div className="hwtabs" role="tablist" aria-label="How it works">
          {HOW_IT_WORKS.map((x, k) => (
            <button key={x.title} role="tab" aria-selected={how === k} className={how === k ? "on" : ""} onClick={() => setHow(k)}>
              <span className="step-n">{k + 1}</span>
              {x.title}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ maxWidth: "60ch" }}>
          {HOW_IT_WORKS[how].body}
        </p>
        <div className="grid g2" style={{ marginTop: 20, alignItems: "start" }}>
          <div className="wiz" style={{ gridTemplateColumns: "1fr" }}>
            <div className="wsteps">
              {["Agent name", "Description", "Capabilities", "Pricing"].map((s, i) => (
                <div key={s} className={`wstep ${i === 1 ? "on" : i < 1 ? "done" : ""}`}>
                  <span className="step-n">{i < 1 ? <Icon name="check" size={12} /> : i + 1}</span>
                  {s}
                </div>
              ))}
            </div>
          </div>
          <ul className="chk">
            <li className="done">
              <span className="ic">
                <Icon name="check" />
              </span>
              Defining research scope<span className="stt">Done</span>
            </li>
            <li className="doing">
              <span className="ic">
                <Icon name="check" />
              </span>
              Collecting company information<span className="stt">Working</span>
            </li>
            <li>
              <span className="ic">
                <Icon name="check" />
              </span>
              Generating final report<span className="stt">Queued</span>
            </li>
          </ul>
        </div>
        <div className="dpanel">
          <div className="stagebar">
            {STAGES.map((x, i) => (
              <div key={x} className={`stg ${i < stage ? "done" : i === stage ? "on" : ""}`}>
                <i />
                <span>{x}</span>
              </div>
            ))}
          </div>
          <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setStage((s) => (s + 1) % 6)}>
            Advance stage
          </button>
        </div>
        <div className="chain" style={{ marginTop: 16 }}>
          {TODAY_CHAIN.map((x, i) => (
            <span key={x} style={{ display: "contents" }}>
              <span className={`cchip ${i === TODAY_CHAIN.length - 1 ? "bad" : ""}`}>{x}</span>
              {i < TODAY_CHAIN.length - 1 && <Icon name="arrow" />}
            </span>
          ))}
        </div>
        <div className="chain" style={{ marginTop: 12 }}>
          <span className="cchip big ac">Describe the outcome</span>
          <Icon name="arrow" />
          <span className="cchip big">Ensemblis handles the rest</span>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <div className="pipe">
            {PIPE.map((p, k) => (
              <span key={p.role} style={{ display: "contents" }}>
                <div className="pnode">
                  <div className="tiny muted">{p.role}</div>
                  <b className="small">{p.agent}</b>
                </div>
                {k < PIPE.length - 1 && (
                  <div className="parrow">
                    <Icon name="arrow" />
                  </div>
                )}
              </span>
            ))}
          </div>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- orchestration */}
      <Sec id="orch" title="Orchestration" sub={<><Code>.orch</Code> with <Code>.node(.q .m .w .d .out)</Code>, <Code>.conn(.act)</Code>, <Code>.pb</Code>; <Code>.orch.loop</Code> animates continuously.</>}>
        <div className="grid g2" style={{ alignItems: "start" }}>
          <div className="card">
            <Orch loop />
          </div>
          <div className="card">
            <Orch loop={false} stage={stage} done={stage >= 5} />
          </div>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- feedback */}
      <Sec id="feedback" title="Modals, toasts & celebration" sub={<><Code>{"<Modal open onClose title wide?/>"}</Code>, <Code>useToast()</Code>, <Code>confetti()</Code>, <Code>useShell()</Code> for palette / shortcuts / role select.</>}>
        <div className="row wrapflex">
          <button className="btn" onClick={() => setModal("basic")}>
            Open modal
          </button>
          <button className="btn" onClick={() => setModal("wide")}>
            Wide modal
          </button>
          <button className="btn bad" onClick={() => setModal("confirm")}>
            Confirm dialog
          </button>
          <button className="btn" onClick={() => toast("Workflow activated")}>
            Toast
          </button>
          <button className="btn" onClick={() => toast.error("Couldn't reach the Ensemblis server.")}>
            Error toast
          </button>
          <button className="btn" onClick={() => toast.info("Link copied", { icon: "copy", action: { label: "Undo", onClick: () => toast("Undone") } })}>
            Toast with action
          </button>
          <button
            className="btn p"
            onClick={() => {
              confetti();
              toast("Your work is ready");
            }}
          >
            <Icon name="spark" />
            Confetti
          </button>
          <button className="btn" onClick={shell.openPalette}>
            <Icon name="search" />
            Command palette
          </button>
          <button className="btn" onClick={shell.openShortcuts}>
            <Icon name="keyboard" />
            Shortcuts
          </button>
          <button className="btn" onClick={() => shell.openRoleSelect()}>
            Role select
          </button>
        </div>
        <Modal open={modal === "basic"} onClose={() => setModal(null)} title="Share result">
          <p className="muted small" style={{ margin: "6px 0 14px" }}>
            Anyone with the link can view.
          </p>
          <div className="row">
            <input className="f" readOnly value="ensemblis.com/r/8f3k2x" aria-label="Share link" />
            <button
              className="btn p"
              onClick={() => {
                setModal(null);
                toast("Link copied");
              }}
            >
              Copy
            </button>
          </div>
        </Modal>
        <Modal open={modal === "wide"} onClose={() => setModal(null)} title="Compare agents" wide>
          <p className="muted small" style={{ margin: "4px 0 14px" }}>
            Choose who handles: <b>Collects company and market information</b>
          </p>
          <div className="stack">
            <div className="card tight opt sel">
              <div className="row">
                <Avatar name="Research Agent" hue={200} />
                <div className="sp">
                  <b className="small">Research Agent</b>
                  <div className="tiny muted">Current · 97.1% success · €15</div>
                </div>
                <Tag variant="ok">Selected</Tag>
              </div>
            </div>
            <div className="card tight opt">
              <div className="row">
                <Avatar name="Research Analyst" hue={200} />
                <div className="sp">
                  <b className="small">Research Analyst</b>
                  <div className="tiny muted">97.0% success · 4.8/5 · €19</div>
                </div>
                <span className="btn sm">Use instead</span>
              </div>
            </div>
          </div>
        </Modal>
        <Modal open={modal === "confirm"} onClose={() => setModal(null)} title="Delete this workflow?">
          <p className="muted small" style={{ margin: "6px 0 16px" }}>
            This can&apos;t be undone. It won&apos;t affect work already delivered.
          </p>
          <div className="row">
            <button className="btn" onClick={() => setModal(null)}>
              Keep workflow
            </button>
            <button
              className="btn bad"
              onClick={() => {
                setModal(null);
                toast("Workflow deleted");
              }}
            >
              Delete workflow
            </button>
          </div>
        </Modal>
      </Sec>

      {/* ---------------------------------------------------------- loading */}
      <Sec id="loading" title="Loading, progress & empty states" sub={<><Code>{"<Skeleton/>"}</Code>, <Code>{"<SkeletonText/>"}</Code>, <Code>{"<SkeletonCard/>"}</Code>, <Code>{"<ProgressBar/>"}</Code>, <Code>.spin</Code>, <Code>{"<EmptyState/>"}</Code>, <Code>{"<Reveal/>"}</Code>.</>}>
        <div className="grid g3" style={{ alignItems: "start" }}>
          <SkeletonCard />
          <div className="card">
            <Skeleton width="50%" height={16} />
            <div style={{ height: 14 }} />
            <SkeletonText lines={3} />
          </div>
          <div className="card stack">
            <div>
              <div className="row between small">
                <b>Research Agent</b>
                <span className="muted">80%</span>
              </div>
              <ProgressBar value={80} style={{ marginTop: 8 }} />
            </div>
            <div className="pb" aria-hidden="true">
              <i />
            </div>
            <div className="row small muted">
              <span className="spin" aria-hidden="true" /> Loading agents…
            </div>
            <div className="onb done">
              <span className="ic">
                <Icon name="check" />
              </span>
              <b className="small">Describe a task</b>
            </div>
            <div className="onb">
              <span className="ic">
                <Icon name="check" />
              </span>
              <b className="small">Review your team</b>
            </div>
          </div>
        </div>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <EmptyState icon="list" title="Nothing here yet." action={{ label: "New task", href: "/new", icon: "plus" }}>
            Start a new task and it will appear here.
          </EmptyState>
          <Reveal className="card">
            <h3>Reveal</h3>
            <p className="small muted">This card fades in when scrolled into view (skipped with reduced motion).</p>
          </Reveal>
        </div>
      </Sec>

      {/* ---------------------------------------------------------- icons */}
      <Sec id="icons" title="Icons" sub={<><Code>{'<Icon name="check" />'}</Code> — {Object.keys(ICONS).length} icons, 18px default, <Code>size</Code> prop to override.</>}>
        <div className="grid g6 keep2" style={{ gap: 10 }}>
          {(Object.keys(ICONS) as IconName[]).map((n) => (
            <div key={n} className="mini row" style={{ gap: 10, margin: 0 }}>
              <Icon name={n} />
              <span className="tiny">{n}</span>
            </div>
          ))}
        </div>
      </Sec>

      {/* ---------------------------------------------------------- dark */}
      <Sec id="dark" title="Dark sections" sub={<><Code>.dk</Code> forces the dark palette on any section (header, hero, CTA band) in both themes. Hero: <Code>section.dk.hero-dk</Code> + <Code>.hx</Code>.</>}>
        <section className="dk hero-dk" style={{ borderRadius: 16, padding: "48px 0" } as CSSProperties}>
          <div className="hx" style={{ padding: "0 28px" }}>
            <div className="hx-badge">
              <span className="pulse" />
              The marketplace for AI work
            </div>
            <h1 style={{ fontSize: "clamp(34px,5vw,56px)" }}>AI agents that do the work.</h1>
            <p className="sub">Describe the outcome you need. Ensemblis finds, coordinates, and manages the AI agents required to get it done.</p>
            <div className="row wrapflex" style={{ gap: 10, marginTop: 26 }}>
              <button className="btn p lg">Get work done</button>
              <button className="btn lg">Explore agents</button>
            </div>
            <div className="examples">
              {["Research my competitors", "Find 100 qualified leads"].map((e) => (
                <button key={e} className="chip">
                  {e}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="dk cta-band" style={{ borderRadius: 16, marginTop: 16, padding: "48px 28px" }}>
          <h2>Tell us what needs to get done.</h2>
          <div className="row wrapflex" style={{ marginTop: 26 }}>
            <button className="btn p lg">Get started</button>
            <button className="btn lg">Explore agents</button>
          </div>
        </section>
        <div className="card" style={{ marginTop: 16, padding: "8px 28px" }}>
          <div className="rsec">
            <h2>Key Findings</h2>
            <div className="claim">
              <div>Helix Immersion raised €48M in a Series C round in June 2026.</div>
              <div className="vrow">
                <span className="srcchip">
                  <Icon name="link" />
                  Press release + registry filing
                </span>
                <span className="tiny muted">Verified Sep 2026</span>
                <Tag variant="ok">Verified</Tag>
                <span className="conf">
                  <i className="on" />
                  <i className="on" />
                  <i className="on" />
                  <span>High confidence</span>
                </span>
              </div>
            </div>
          </div>
          <div className="tiny muted" style={{ padding: "10px 0" }}>
            <Code>.rsec</Code>, <Code>.claim</Code>, <Code>.vrow</Code>, <Code>.srcchip</Code>, <Code>.conf</Code> — report layout (with <Code>.report</Code> + <Code>.toc</Code> grid).
          </div>
        </div>
      </Sec>
    </div>
  );
}
