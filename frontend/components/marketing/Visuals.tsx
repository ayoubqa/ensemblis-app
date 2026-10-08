// Creative visuals for the marketing pages (Brand + Creative Web Pack directions:
// operating layer, outcome convergence, AI organization, execution lifecycle,
// evidence layer). Pure HTML/CSS/SVG, server-rendered, no images and no client JS.
// They depict how Ensemblis works with an EXAMPLE objective and are labelled as
// illustrations — never presented as a real execution, customer or metric.
// Styles: app/styles/marketing.css (mk- prefix).
import { Icon, type IconName } from "@/components/Icon";
import { CHIEF_OF_STAFF, DEPARTMENTS, EXAMPLE, HOW, TOOLS, VERIFICATION_CHECKS } from "@/app/_home/content";

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <figcaption className="mk-caption">
      <Icon name="info" size={13} />
      {children}
    </figcaption>
  );
}

// ------------------------------------------------------------------ A/E. Hero: the operating layer
export function OperatingLayer() {
  const lanes: { name: string; icon: IconName }[] = DEPARTMENTS.map((d) => ({ name: d.name, icon: d.icon }));
  return (
    <figure className="mk-layer" aria-labelledby="mk-layer-cap">
      <div className="mk-layer-card mk-layer-objective">
        <span className="mk-k">Business objective</span>
        <p>Recommend the three highest-potential European markets for expansion.</p>
        <ul className="mk-crit" aria-label="Success criteria">
          {EXAMPLE.criteria.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>

      <div className="mk-link" aria-hidden="true" />

      <div className="mk-layer-band">
        <div className="mk-band-head">
          <span className="mk-cos">
            <Icon name="compass" size={15} />
            Chief of Staff
          </span>
          <span className="mk-band-tag">Ensemblis operating layer</span>
        </div>
        <ol className="mk-band-steps" aria-label="Lifecycle">
          {["Plan", "Approve", "Execute", "Verify"].map((s, i) => (
            <li key={s} style={{ ["--i" as string]: i }}>
              <span aria-hidden="true" className="mk-dot" />
              {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="mk-fan" aria-hidden="true">
        <svg viewBox="0 0 400 34" preserveAspectRatio="none">
          <path d="M200 0 C200 18 50 14 50 34" />
          <path d="M200 0 C200 18 150 14 150 34" />
          <path d="M200 0 C200 18 250 14 250 34" />
          <path d="M200 0 C200 18 350 14 350 34" />
        </svg>
      </div>

      <ul className="mk-lanes" aria-label="AI Team">
        {lanes.map((l, i) => (
          <li key={l.name} style={{ ["--i" as string]: i }}>
            <Icon name={l.icon} size={15} />
            {l.name}
          </li>
        ))}
      </ul>

      <div className="mk-link" aria-hidden="true" />

      <div className="mk-layer-card mk-layer-outcome">
        <div className="mk-outcome-head">
          <span className="mk-k">Outcome</span>
          <span className="mk-pass">
            <Icon name="shield" size={13} />
            Verification passed
          </span>
        </div>
        <ul className="mk-met">
          {EXAMPLE.criteria.map((c) => (
            <li key={c}>
              <Icon name="check" size={14} />
              {c}
            </li>
          ))}
        </ul>
        <div className="mk-evidence-row" aria-label="Evidence">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="mk-cite">
              [{n}]
            </span>
          ))}
          <span className="mk-ev-label">cited evidence</span>
        </div>
      </div>
      <Caption>
        <span id="mk-layer-cap">Illustration with an example objective — not a real execution.</span>
      </Caption>
    </figure>
  );
}

// ------------------------------------------------------------------ Problem: tool sprawl
export function ToolSprawl() {
  // Tool tiles on an ellipse around the team (centre coordinates, %); the dashed
  // paths are the manual work people do between tools.
  const pos = [
    { x: 50, y: 12 },
    { x: 80, y: 31 },
    { x: 80, y: 69 },
    { x: 50, y: 88 },
    { x: 20, y: 69 },
    { x: 20, y: 31 },
  ];
  const chores = [
    { t: "copy", x: 50, y: 30 },
    { t: "research", x: 67, y: 39 },
    { t: "reconcile", x: 67, y: 61 },
    { t: "report", x: 50, y: 71 },
    { t: "chase", x: 33, y: 61 },
    { t: "repeat", x: 33, y: 39 },
  ];
  return (
    <figure className="mk-sprawl" aria-labelledby="mk-sprawl-cap">
      <svg className="mk-sprawl-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {pos.map((p, i) => (
          <path key={i} d={`M${p.x} ${p.y} Q ${(p.x + 50) / 2 + (i % 2 ? 6 : -6)} ${(p.y + 50) / 2} 50 50`} />
        ))}
      </svg>
      {TOOLS.map((t, i) => (
        <div key={t.label} className="mk-tool" style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }}>
          <Icon name={t.icon} size={15} />
          {t.label}
        </div>
      ))}
      {chores.map((c) => (
        <span key={c.t} className="mk-chore" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
          {c.t}
        </span>
      ))}
      <div className="mk-you">
        <Icon name="user" size={16} />
        Your team, in the middle
      </div>
      <figcaption id="mk-sprawl-cap" className="sr-only">
        Business tools — CRM, project management, spreadsheets, analytics, communication and a knowledge base — with people in the middle copying, researching, reconciling and reporting between them.
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ Shift: tools → intelligence → execution → outcome
export function ToolsToOutcome() {
  return (
    <figure className="mk-shift" aria-labelledby="mk-shift-cap">
      <div className="mk-shift-col mk-shift-tools">
        <span className="mk-k">Tools</span>
        {TOOLS.slice(0, 4).map((t) => (
          <div key={t.label} className="mk-ghost">
            <Icon name={t.icon} size={14} />
            {t.label}
          </div>
        ))}
      </div>
      <Arrow />
      <div className="mk-shift-col">
        <span className="mk-k">Intelligence</span>
        <div className="mk-node">
          <Icon name="compass" size={15} />
          <div>
            <b>Chief of Staff</b>
            <small>plans against your objective</small>
          </div>
        </div>
        <div className="mk-node">
          <Icon name="file" size={15} />
          <div>
            <b>Company Context</b>
            <small>your business, once</small>
          </div>
        </div>
      </div>
      <Arrow />
      <div className="mk-shift-col">
        <span className="mk-k">Execution</span>
        {DEPARTMENTS.map((d) => (
          <div key={d.key} className="mk-node mk-node-sm">
            <Icon name={d.icon} size={14} />
            <b>{d.name}</b>
            <span className="mk-bar" aria-hidden="true" />
          </div>
        ))}
      </div>
      <Arrow />
      <div className="mk-shift-col mk-shift-out">
        <span className="mk-k">Outcome</span>
        <div className="mk-outcard">
          <span className="mk-pass">
            <Icon name="check" size={13} />
            Verified
          </span>
          <b>Objective achieved</b>
          <small>Every success criterion measured, every claim cited.</small>
        </div>
      </div>
      <figcaption id="mk-shift-cap" className="sr-only">
        Fragmented tools give way to an operating layer: the Chief of Staff and your Company Context plan the work, the AI Team executes it across Marketing, Sales, Finance and Operations, and the result is a verified outcome.
      </figcaption>
    </figure>
  );
}

function Arrow() {
  return (
    <div className="mk-arrow" aria-hidden="true">
      <svg viewBox="0 0 40 12">
        <path d="M0 6h34" />
        <path d="M30 1l6 5-6 5" />
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ How it works: the five moves
export function Lifecycle() {
  return (
    <ol className="mk-life">
      {HOW.map((s, i) => (
        <li key={s.n} style={{ ["--i" as string]: i }}>
          <div className="mk-life-top">
            <span className="mk-life-n" aria-hidden="true">
              {s.n}
            </span>
            <span className="mk-life-status">{s.status}</span>
          </div>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ Chief of Staff: the executive briefing
export function Briefing() {
  return (
    <figure className="mk-brief" aria-labelledby="mk-brief-cap">
      <div className="mk-brief-head">
        <span className="mk-cos">
          <Icon name="compass" size={15} />
          Chief of Staff
        </span>
        <span className="mk-status">Awaiting your approval</span>
      </div>
      <div className="mk-brief-sec">
        <span className="mk-k">Objective</span>
        <p className="mk-brief-obj">{EXAMPLE.objective}</p>
      </div>
      <div className="mk-brief-sec">
        <span className="mk-k">Success criteria</span>
        <ul className="mk-crit">
          {EXAMPLE.criteria.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <div className="mk-brief-sec">
        <span className="mk-k">Plan</span>
        <ol className="mk-plan">
          {EXAMPLE.plan.map((p, i) => (
            <li key={p.step}>
              <span className="mk-plan-n" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <span className="mk-owner">
                  {p.owner} · {p.specialist}
                </span>
                <span>{p.step}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="mk-brief-foot">
        <span>The plan and its estimated cost are shown before anything starts.</span>
        <span className="mk-fake-btn" aria-hidden="true">
          Approve plan
        </span>
      </div>
      <Caption>
        <span id="mk-brief-cap">Illustration with an example objective — not a real execution.</span>
      </Caption>
    </figure>
  );
}

// ------------------------------------------------------------------ AI Team: the organization
export function OrgChart() {
  return (
    <figure className="mk-org" aria-labelledby="mk-org-cap">
      <div className="mk-org-root">
        <span className="mk-org-ico">
          <Icon name="compass" size={18} />
        </span>
        <div>
          <b>{CHIEF_OF_STAFF.title}</b>
          <small>{CHIEF_OF_STAFF.role}</small>
          <ul className="mk-caps">
            {CHIEF_OF_STAFF.capabilities.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mk-org-rail" aria-hidden="true" />
      <ul className="mk-org-depts">
        {DEPARTMENTS.map((d) => (
          <li key={d.key}>
            <div className="mk-org-dept">
              <span className="mk-org-ico">
                <Icon name={d.icon} size={16} />
              </span>
              <div>
                <b>{d.name}</b>
                <small>{d.title}</small>
              </div>
            </div>
            <ul className="mk-caps">
              {d.capabilities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <figcaption id="mk-org-cap" className="mk-caption">
        <Icon name="info" size={13} />
        The AI Team as it exists in Ensemblis today: a Chief of Staff, four executives and their specialist capabilities.
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ Execution: lifecycle + trace
const TRACE: { who: string; what: string; tone?: "ok" | "accent" | "warn" }[] = [
  { who: "Chief of Staff", what: "Plan ready: 5 steps across Marketing and Finance" },
  { who: "You", what: "Approved the plan and its estimated cost", tone: "accent" },
  { who: "Market Research", what: "Completed “Research candidate markets” — 6 sources added as evidence" },
  { who: "Competitor Analysis", what: "Completed “Map competitors in each market”" },
  { who: "Financial Analysis", what: "Completed “Compare the economics of entry”" },
  { who: "Synthesis", what: "Drafted the recommendation against the success criteria" },
  { who: "Verification", what: "All checks passed: evidence, criteria, completeness, consistency", tone: "ok" },
  { who: "Outcome", what: "3 of 3 success criteria met", tone: "ok" },
];

export function ExecutionTrace() {
  const phases = ["Plan", "Approve", "Execute", "Verify", "Evidence", "Outcome"];
  return (
    <figure className="mk-exec" aria-labelledby="mk-exec-cap">
      <ol className="mk-phases" aria-label="Lifecycle">
        {phases.map((p, i) => (
          <li key={p} style={{ ["--i" as string]: i }}>
            <span className="mk-ph-dot" aria-hidden="true" />
            {p}
          </li>
        ))}
      </ol>
      <ol className="mk-trace">
        {TRACE.map((t, i) => (
          <li key={i} className={t.tone ? `t-${t.tone}` : undefined} style={{ ["--i" as string]: i }}>
            <span className="mk-trace-dot" aria-hidden="true" />
            <span className="mk-trace-who">{t.who}</span>
            <span className="mk-trace-what">{t.what}</span>
          </li>
        ))}
      </ol>
      <Caption>
        <span id="mk-exec-cap">Illustration of an example activity log — the console shows the real one for every execution.</span>
      </Caption>
    </figure>
  );
}

// ------------------------------------------------------------------ Trust: the evidence layer
export function EvidenceLayer() {
  const ev: { n: number; kind: string; label: string; icon: IconName }[] = [
    { n: 1, kind: "Company Context", label: "Products, customers and goals", icon: "file" },
    { n: 2, kind: "Document", label: "Your uploaded market study", icon: "file" },
    { n: 3, kind: "Web source", label: "Public market statistics", icon: "globe" },
    { n: 4, kind: "Calculation", label: "Entry economics per market", icon: "chart" },
  ];
  return (
    <figure className="mk-evl" aria-labelledby="mk-evl-cap">
      <ul className="mk-evl-sources" aria-label="Evidence">
        {ev.map((e) => (
          <li key={e.n}>
            <span className="mk-cite">[{e.n}]</span>
            <div>
              <small>{e.kind}</small>
              <b>{e.label}</b>
            </div>
          </li>
        ))}
      </ul>
      <div className="mk-evl-core">
        <div className="mk-outcome-head">
          <span className="mk-k">Verification</span>
          <span className="mk-pass">
            <Icon name="shield" size={13} />
            Passed
          </span>
        </div>
        <ul className="mk-checks">
          {VERIFICATION_CHECKS.map((c) => (
            <li key={c}>
              <Icon name="check" size={14} />
              {c}
            </li>
          ))}
        </ul>
        <div className="mk-claim">
          <p>
            “Germany is the largest addressable market in the region <span className="mk-cite">[3]</span>, and your existing customers there shorten entry <span className="mk-cite">[1]</span>.”
          </p>
          <span className="mk-supported">
            <Icon name="check" size={12} />
            Claim supported by evidence
          </span>
        </div>
      </div>
      <Caption>
        <span id="mk-evl-cap">Illustration — the verification checks are the ones Ensemblis runs; the claim and sources are an example.</span>
      </Caption>
    </figure>
  );
}

// ------------------------------------------------------------------ Company Context: the context layer
export function ContextLayer({ fields, memory }: { fields: string[]; memory: string[] }) {
  return (
    <figure className="mk-ctx" aria-labelledby="mk-ctx-cap">
      <div className="mk-ctx-stack">
        <div className="mk-ctx-layer l1">
          <span className="mk-k">Company profile</span>
          <ul>
            {fields.slice(0, 6).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
        <div className="mk-ctx-layer l2">
          <span className="mk-k">Website & documents</span>
          <ul>
            {fields.slice(6).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
        <div className="mk-ctx-layer l3">
          <span className="mk-k">Organizational memory</span>
          <ul>
            {memory.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mk-ctx-flow" aria-hidden="true">
        <svg viewBox="0 0 60 120" preserveAspectRatio="none">
          <path d="M0 20 C30 20 30 60 60 60" />
          <path d="M0 60 H60" />
          <path d="M0 100 C30 100 30 60 60 60" />
        </svg>
      </div>
      <div className="mk-ctx-target">
        <span className="mk-k">Every objective</span>
        <b>Planned and executed with your context</b>
        <small>Documents are treated as data — never as instructions to the AI.</small>
      </div>
      <figcaption id="mk-ctx-cap" className="sr-only">
        Company profile, website, documents and organizational memory feed every objective Ensemblis plans and executes.
      </figcaption>
    </figure>
  );
}
