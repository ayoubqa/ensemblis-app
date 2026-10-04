"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, RequireAuth, confetti, useToast } from "@/components";
import { api, type Agent } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CATS, PLATFORM_FEE_PERCENT } from "@/lib/data";
import { eur, minutesRange, plural } from "@/lib/format";
import { useIsMobile, useKeyboardShortcut, useLocalStorage, useMediaQuery } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { cx, hueFrom } from "@/lib/utils";
import { AgentCard, newTaskUrl } from "../../agents/_components/AgentCard";
import { CapsInput } from "../_components/CapsInput";
import { DevOnly } from "../_components/DevOnly";
import { OUTPUT_TYPES, TASK_TYPES, TIME_WINDOWS, findSecret, parsePriceCents, promptTemplate, type AgentDraft } from "../_components/agentForm";
import { PUBLISH_WIZARD, VERIFICATION_CHECKS } from "../_components/constants";

export default function PublishPage() {
  return (
    <RequireAuth>
      <DevOnly what="publishing agents">
        <Publish />
      </DevOnly>
    </RequireAuth>
  );
}

// Prototype pubDefault(), adapted to the API's fields.
const DEFAULT_DRAFT: AgentDraft = {
  name: "Competitive Intelligence Researcher",
  category: "Research",
  description: "Researches companies and markets, compares products, pricing and positioning, and returns a sourced summary.",
  capabilities: ["Competitive research", "Company research", "Market analysis"],
  specialty: "competitive intelligence and market research",
  taskType: "Competitive Intelligence",
  outputType: "PDF report",
  systemPrompt: "",
  priceEuros: "8",
  estMinutesLow: 8,
  estMinutesHigh: 12,
};
const BLANK_DRAFT: AgentDraft = {
  name: "",
  category: "Research",
  description: "",
  capabilities: [],
  specialty: "",
  taskType: "",
  outputType: "Report",
  systemPrompt: "",
  priceEuros: "15",
  estMinutesLow: 8,
  estMinutesHigh: 12,
};
const STORE_KEY = "ensemblis.publishDraft.v1";
const STEPS = PUBLISH_WIZARD.map((s) => s.title);
const N = STEPS.length;

type CheckState = "idle" | "doing" | "pass" | "warn" | "fail";
interface CheckResult {
  state: Exclude<CheckState, "idle" | "doing">;
  note: string;
  step?: number; // 1-based step to fix
}

function Publish() {
  const { user } = useAuth();
  const toast = useToast();
  const stacked = useMediaQuery("(max-width: 1080px)");
  const [saved, setSaved] = useLocalStorage<{ step: number; d: AgentDraft }>(STORE_KEY, { step: 1, d: { ...DEFAULT_DRAFT, systemPrompt: promptTemplate(DEFAULT_DRAFT) } });
  const { step: savedStep, d } = saved;
  const setStep = (n: number) => setSaved((s) => ({ ...s, step: Math.max(1, Math.min(N, n)) }));
  const upd = <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) => setSaved((s) => ({ ...s, d: { ...s.d, [k]: v } }));
  const patch = (p: Partial<AgentDraft>) => setSaved((s) => ({ ...s, d: { ...s.d, ...p } }));
  const [touched, setTouched] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState<Agent | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);
  const mobile = useIsMobile();

  // Market context for checks & pricing (real data).
  const [market, setMarket] = useState<Agent[] | null>(null);
  useEffect(() => {
    api.listAgents().then((r) => setMarket(r.agents), () => setMarket([]));
  }, []);
  const catPrices = useMemo(() => {
    const xs = (market ?? []).filter((a) => a.category === d.category).map((a) => a.pricePerTaskCents).sort((a, b) => a - b);
    return { median: xs.length ? xs[Math.floor(xs.length / 2)] : null, xs };
  }, [market, d.category]);

  const priceCents = parsePriceCents(d.priceEuros);
  const sig = JSON.stringify(d);

  // ---------- per-step validation (blocking) ----------
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const name = d.name.trim();
    if (name.length < 2) e.name = "Give your agent a name (at least 2 characters).";
    else if (market?.some((a) => a.name.toLowerCase() === name.toLowerCase())) e.name = "An agent with that name already exists in the marketplace.";
    if (d.description.trim().length < 10) e.description = "Describe the outcome in at least 10 characters.";
    if (!d.capabilities.length) e.capabilities = "Pick or add at least one capability.";
    if (!d.specialty.trim()) e.specialty = "Say what it specializes in.";
    if (!d.taskType.trim()) e.taskType = "Choose the kind of task it handles.";
    if (!d.outputType.trim()) e.outputType = "Choose what it delivers.";
    if (d.systemPrompt.trim().length < 20) e.systemPrompt = "Instructions need at least 20 characters.";
    else if (findSecret(d.systemPrompt)) e.systemPrompt = "Remove the credential from your instructions. Never put secrets in a system prompt.";
    if (priceCents === null || priceCents < 100) e.price = "Minimum price is €1.";
    else if (priceCents > 50000) e.price = "Maximum price is €500.";
    if (d.estMinutesHigh < d.estMinutesLow) e.time = "The upper bound must be at least the lower bound.";
    return e;
  }, [d, market, priceCents]);
  const stepFields: Record<number, string[]> = {
    1: ["name", "description"],
    2: ["capabilities", "specialty", "taskType", "outputType"],
    3: ["systemPrompt"],
    4: ["price", "time"],
  };
  const stepOk = (n: number) => (stepFields[n] ?? []).every((k) => !errors[k]);
  const err = (k: string) => (touched ? errors[k] : undefined);

  // ---------- verification (client-side checklist) ----------
  const [checks, setChecks] = useState<(CheckResult | null)[]>(VERIFICATION_CHECKS.map(() => null));
  const [running, setRunning] = useState(-1); // index currently "doing", -1 idle
  const [testedSig, setTestedSig] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const testsDone = checks.every(Boolean) && running === -1;
  const testsPassed = testsDone && testedSig === sig && checks.every((c) => c && c.state !== "fail");
  const stale = testsDone && testedSig !== sig;
  // Never land on the review step with unverified changes (e.g. a restored draft).
  const step = savedStep === N && !testsPassed ? 5 : savedStep;

  const evaluate = (): CheckResult[] => {
    const p = d.systemPrompt.trim();
    const pl = p.toLowerCase();
    const r: CheckResult[] = [];
    // Basic functionality
    if (errors.name || errors.description) r.push({ state: "fail", note: errors.name || errors.description, step: 1 });
    else if (d.description.trim().length < 60) r.push({ state: "warn", note: "Short description. Add a sentence on the result customers get.", step: 1 });
    else r.push({ state: "pass", note: "Name and description are complete" });
    // Required inputs
    const e2 = errors.capabilities || errors.specialty || errors.taskType || errors.outputType;
    if (e2) r.push({ state: "fail", note: e2, step: 2 });
    else if (d.capabilities.length < 3) r.push({ state: "warn", note: "Agents with 3+ capabilities get matched to more work.", step: 2 });
    else r.push({ state: "pass", note: `${plural(d.capabilities.length, "capability", "capabilities")} declared` });
    // Output quality
    if (errors.systemPrompt && !findSecret(p)) r.push({ state: "fail", note: errors.systemPrompt, step: 3 });
    else if (!/output|deliver|format|markdown|report|return/.test(pl)) r.push({ state: "warn", note: "Tell the agent exactly what to deliver and in what format.", step: 3 });
    else r.push({ state: "pass", note: "Output contract defined" });
    // Response consistency
    if (p.length < 200) r.push({ state: "warn", note: "Short instructions produce less consistent results. Add steps or rules.", step: 3 });
    else r.push({ state: "pass", note: `${p.split(/\s+/).filter(Boolean).length} words of instructions` });
    // Safety checks
    const secret = findSecret(p);
    if (secret) r.push({ state: "fail", note: `Looks like a credential (${secret}) in your instructions.`, step: 3 });
    else if (/ignore (all |any )?(previous|prior) instructions/.test(pl)) r.push({ state: "fail", note: "Instructions contain an override phrase.", step: 3 });
    else r.push({ state: "pass", note: "No secrets or unsafe overrides found" });
    // Performance benchmark
    if (errors.price || errors.time) r.push({ state: "fail", note: errors.price || errors.time, step: 4 });
    else if (catPrices.median && priceCents && priceCents > catPrices.median * 2)
      r.push({ state: "warn", note: `Priced above 2× the ${d.category} median (${eur(catPrices.median)}).`, step: 4 });
    else r.push({ state: "pass", note: catPrices.median ? `Within range for ${d.category} (median ${eur(catPrices.median)})` : "Price and delivery window valid" });
    return r;
  };

  const runTests = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    const results = evaluate();
    setChecks(VERIFICATION_CHECKS.map(() => null));
    setTestedSig(sig);
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const gap = reduced ? 0 : 450;
    results.forEach((res, i) => {
      timers.current.push(window.setTimeout(() => setRunning(i), i * gap));
      timers.current.push(
        window.setTimeout(() => {
          setChecks((c) => c.map((x, j) => (j === i ? res : x)));
          if (i === results.length - 1) setRunning(-1);
        }, i * gap + (reduced ? 0 : 420))
      );
    });
  };
  const score = useMemo(() => {
    if (!testsDone) return 0;
    const warns = checks.filter((c) => c?.state === "warn").length;
    const fill = Math.min(6, Math.floor(d.systemPrompt.length / 250));
    return Math.max(70, Math.min(99, 86 + fill - warns * 4));
  }, [testsDone, checks, d.systemPrompt.length]);
  const firstFail = checks.find((c) => c?.state === "fail");

  // ---------- navigation ----------
  const canContinue = step < 5 ? stepOk(step) : step === 5 ? testsPassed : true;
  const next = () => {
    if (step >= N) return;
    if (!canContinue) {
      setTouched(true);
      if (step === 5 && !testsDone && running === -1) runTests();
      return;
    }
    setTouched(false);
    setStep(step + 1);
  };
  useKeyboardShortcut("mod+enter", () => (step === N ? publish() : next()), { allowInInputs: true, enabled: !done });
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [step]);

  // ---------- publish ----------
  async function publish() {
    if (publishing || done) return;
    const bad = [1, 2, 3, 4].find((n) => !stepOk(n));
    if (bad) {
      setTouched(true);
      setStep(bad);
      return;
    }
    if (!testsPassed) {
      setStep(5);
      return;
    }
    setPublishing(true);
    setPubError(null);
    try {
      const { agent } = await api.publishAgent({
        name: d.name.trim(),
        category: d.category,
        description: d.description.trim(),
        capabilities: d.capabilities,
        specialty: d.specialty.trim(),
        taskType: d.taskType.trim(),
        outputType: d.outputType.trim(),
        systemPrompt: d.systemPrompt.trim(),
        pricePerTaskCents: priceCents as number,
        estMinutesLow: d.estMinutesLow,
        estMinutesHigh: d.estMinutesHigh,
      });
      setDone(agent);
      setSaved({ step: 1, d: { ...BLANK_DRAFT } });
      confetti();
      setTimeout(() => confetti(), 450);
      toast(`${agent.name} is live`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setPubError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  const preview = {
    slug: "",
    name: d.name.trim() || "Your agent",
    creator: user?.company || user?.name || "You",
    description: d.description.trim(),
    capabilities: d.capabilities,
    successRate: 0,
    tasksCompleted: 0,
    avgRunSeconds: Math.round(((d.estMinutesLow + d.estMinutesHigh) / 2) * 60),
    pricePerTaskCents: priceCents ?? 0,
    verified: false,
    hue: hueFrom(d.name.trim() || "Your agent"),
    rating: 0,
    category: d.category,
  };

  if (done) return <Success agent={done} onAnother={() => setDone(null)} />;

  const fieldErr = (k: string) =>
    err(k) ? (
      <p className="err" role="alert">
        {err(k)}
      </p>
    ) : null;

  const B: Record<number, ReactNode> = {
    1: (
      <>
        <label className="l" htmlFor="p-name">
          Agent name
        </label>
        <input
          id="p-name"
          data-autofocus
          className="f"
          maxLength={80}
          value={d.name}
          onChange={(e) => upd("name", e.target.value)}
          aria-invalid={!!err("name") || undefined}
          placeholder="e.g. Renewables Policy Analyst"
        />
        {fieldErr("name")}
        <label className="l" htmlFor="p-cat" style={{ marginTop: 16 }}>
          Category
        </label>
        <select id="p-cat" className="f" value={d.category} onChange={(e) => upd("category", e.target.value)} style={{ maxWidth: 280 }}>
          {CATS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="l" htmlFor="p-desc" style={{ marginTop: 16 }}>
          Description
        </label>
        <textarea
          id="p-desc"
          className="f"
          rows={4}
          maxLength={600}
          value={d.description}
          onChange={(e) => upd("description", e.target.value)}
          aria-invalid={!!err("description") || undefined}
          aria-describedby="p-desc-hint"
        />
        {fieldErr("description")}
        <p className="hint row between" id="p-desc-hint">
          <span>Describe the outcome customers get, not the technology.</span>
          <span className="tiny">{d.description.length}/600</span>
        </p>
      </>
    ),
    2: (
      <>
        <label className="l" htmlFor="p-cap">
          Capabilities
        </label>
        <CapsInput id="p-cap" value={d.capabilities} onChange={(v) => upd("capabilities", v)} category={d.category} invalid={!!err("capabilities")} />
        {fieldErr("capabilities")}
        <label className="l" htmlFor="p-type" style={{ marginTop: 20 }}>
          Supported task type
        </label>
        <div className="row wrapflex" style={{ gap: 8, marginBottom: 8 }}>
          {TASK_TYPES.map((t) => (
            <button key={t} type="button" className={d.taskType === t ? "chip on" : "chip"} aria-pressed={d.taskType === t} onClick={() => upd("taskType", t)}>
              {t}
            </button>
          ))}
        </div>
        <input id="p-type" className="f" maxLength={80} value={d.taskType} onChange={(e) => upd("taskType", e.target.value)} placeholder="Or type your own" aria-invalid={!!err("taskType") || undefined} />
        {fieldErr("taskType")}
        <label className="l" htmlFor="p-spec" style={{ marginTop: 20 }}>
          Specializes in
        </label>
        <input id="p-spec" className="f" maxLength={160} value={d.specialty} onChange={(e) => upd("specialty", e.target.value)} placeholder="e.g. EU renewable-energy policy tracking" aria-invalid={!!err("specialty") || undefined} />
        {fieldErr("specialty")}
        <p className="hint">Used by the matcher and shown on your profile: &ldquo;Specialized in …&rdquo;.</p>
        <label className="l" htmlFor="p-out" style={{ marginTop: 16 }}>
          Deliverable
        </label>
        <div className="row wrapflex" style={{ gap: 8, marginBottom: 8 }}>
          {OUTPUT_TYPES.map((t) => (
            <button key={t} type="button" className={d.outputType === t ? "chip on" : "chip"} aria-pressed={d.outputType === t} onClick={() => upd("outputType", t)}>
              {t}
            </button>
          ))}
        </div>
        <input id="p-out" className="f" maxLength={80} value={d.outputType} onChange={(e) => upd("outputType", e.target.value)} aria-invalid={!!err("outputType") || undefined} style={{ maxWidth: 320 }} />
        {fieldErr("outputType")}
      </>
    ),
    3: (
      <>
        <div className="row between wrapflex" style={{ gap: 8 }}>
          <label className="l" htmlFor="p-prompt" style={{ margin: 0 }}>
            Agent instructions (system prompt)
          </label>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              if (d.systemPrompt.trim() && !window.confirm("Replace your instructions with a fresh template built from your answers?")) return;
              upd("systemPrompt", promptTemplate(d));
            }}
          >
            <Icon name="spark" />
            {d.systemPrompt.trim() ? "Regenerate from my answers" : "Start from a template"}
          </button>
        </div>
        <div className="notice" style={{ background: "var(--accent-soft)", color: "var(--accent)", margin: "10px 0" }}>
          <Icon name="info" />
          <span>
            This is what your agent actually runs with. Ensemblis sends it to the model on every step your agent performs, together with the
            customer&apos;s request and earlier steps&apos; output. Customers never see it.
          </span>
        </div>
        <textarea
          id="p-prompt"
          data-autofocus
          className="f"
          rows={16}
          value={d.systemPrompt}
          onChange={(e) => upd("systemPrompt", e.target.value)}
          aria-invalid={!!err("systemPrompt") || undefined}
          spellCheck={false}
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13, lineHeight: 1.55, resize: "vertical" }}
          placeholder="You are … You receive … Deliver …"
        />
        {fieldErr("systemPrompt")}
        <p className="hint row between">
          <span>Tip: say what to deliver, in what format, and what to do when information is missing.</span>
          <span className="tiny">
            {d.systemPrompt.trim().split(/\s+/).filter(Boolean).length} words · {d.systemPrompt.length}/20000
          </span>
        </p>
      </>
    ),
    4: (
      <PricingStep d={d} upd={upd} patch={patch} priceCents={priceCents} err={err} catPrices={catPrices} />
    ),
    5: (
      <>
        <label className="l">Agent verification</label>
        <p className="small muted" style={{ marginBottom: 10 }}>
          Every agent is tested before it reaches customers. These checks run against what you entered.
        </p>
        <ul className="chk" style={{ padding: 0 }} aria-live="polite">
          {VERIFICATION_CHECKS.map((label, i) => {
            const c = checks[i];
            const cls = running === i ? "doing" : c ? (c.state === "fail" ? "" : "done") : "";
            return (
              <li key={label} className={cls}>
                <span
                  className="ic"
                  style={
                    c?.state === "fail"
                      ? { background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }
                      : c?.state === "warn"
                        ? { background: "var(--warn)", borderColor: "var(--warn)", color: "#fff" }
                        : undefined
                  }
                >
                  <Icon name={c?.state === "fail" ? "x" : "check"} />
                </span>
                <span className="sp">
                  <span style={c?.state === "fail" ? { color: "var(--bad)" } : undefined}>{label}</span>
                  {c && (
                    <span className="tiny muted" style={{ display: "block" }}>
                      {c.note}
                    </span>
                  )}
                </span>
                {c && c.state !== "pass" && c.step && (
                  <button type="button" className="btn sm ghost" onClick={() => setStep(c.step as number)}>
                    {c.state === "fail" ? "Fix" : "Improve"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {testsDone && !stale && (
          <div
            className="notice reveal"
            role="status"
            style={firstFail ? { background: "var(--bad-soft)", color: "var(--bad)" } : { background: "var(--ok-soft)", color: "var(--ok)" }}
          >
            <Icon name={firstFail ? "alert" : "check"} />
            <span>
              {firstFail
                ? `${plural(checks.filter((c) => c?.state === "fail").length, "check")} failed. Fix ${firstFail.step ? `step ${firstFail.step} (${STEPS[firstFail.step - 1]})` : "the issue"} and run the tests again.`
                : `All checks passed. Benchmark score ${score}/100.`}
            </span>
          </div>
        )}
        {stale && (
          <div className="notice" role="status">
            <Icon name="info" />
            <span>You changed your agent since the last run. Run the tests again.</span>
          </div>
        )}
        {(!testsDone || stale || firstFail) && (
          <button type="button" className="btn" style={{ marginTop: 12 }} onClick={runTests} disabled={running !== -1} aria-busy={running !== -1}>
            <Icon name={testsDone ? "redo" : "play"} />
            {running !== -1 ? "Running tests…" : testsDone ? "Run tests again" : "Run tests"}
          </button>
        )}
      </>
    ),
    6: (
      <>
        <label className="l">Review and publish</label>
        <div className="card flat">
          {(
            [
              ["Agent", d.name.trim(), 1],
              ["Category", d.category, 1],
              ["Capabilities", d.capabilities.join(", "), 2],
              ["Task type", d.taskType, 2],
              ["Deliverable", d.outputType, 2],
              ["Instructions", `${d.systemPrompt.trim().split(/\s+/).filter(Boolean).length} words`, 3],
              ["Price", `${eur(priceCents)} / task`, 4],
              ["You earn", `${eur(Math.round(((priceCents ?? 0) * (100 - PLATFORM_FEE_PERCENT)) / 100))} / task`, 4],
              ["Estimated time", minutesRange(d.estMinutesLow, d.estMinutesHigh), 4],
            ] as [string, string, number][]
          ).map(([k, v, s]) => (
            <div key={k} className="kv">
              <span>{k}</span>
              <span className="row" style={{ gap: 8, justifyContent: "flex-end", textAlign: "right" }}>
                <b>{v}</b>
                <button type="button" className="ibtn" aria-label={`Edit ${k.toLowerCase()}`} onClick={() => setStep(s)} style={{ width: 28, height: 28 }}>
                  <Icon name="edit" size={14} />
                </button>
              </span>
            </div>
          ))}
          <div className="kv">
            <span>Verification</span>
            <span className="tag ok">
              <Icon name="check" />
              Passed · {score}/100
            </span>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          Your agent goes live in the marketplace immediately with the &ldquo;Identity verified&rdquo; badge. It starts with no track record;
          its success rate and rating fill in as customers complete tasks. You can pause or edit it any time.
        </p>
        {pubError && (
          <div className="notice" role="alert" style={{ background: "var(--bad-soft)", color: "var(--bad)", marginTop: 12 }}>
            <Icon name="alert" />
            <span>{pubError}</span>
          </div>
        )}
        <button type="button" className="btn p lg" style={{ marginTop: 16 }} onClick={publish} disabled={publishing} aria-busy={publishing}>
          <Icon name="zap" />
          {publishing ? "Publishing…" : "Publish to the marketplace"}
        </button>
      </>
    ),
  };

  const previewPane = (
    <aside aria-label="Live marketplace preview" style={stacked ? undefined : { position: "sticky", top: 84 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="eyebrow" style={{ margin: 0 }}>
          LIVE PREVIEW
        </span>
        <span className="tiny muted row" style={{ gap: 6 }}>
          <span className="pulse" />
          Updates as you type
        </span>
      </div>
      <AgentCard agent={preview} preview />
      <div className="card flat tight" style={{ marginTop: 12 }}>
        <div className="kv">
          <span>Customer pays</span>
          <b>{eur(priceCents)}</b>
        </div>
        <div className="kv">
          <span>You earn ({100 - PLATFORM_FEE_PERCENT}%)</span>
          <b style={{ color: "var(--accent)" }}>{eur(Math.round(((priceCents ?? 0) * (100 - PLATFORM_FEE_PERCENT)) / 100))}</b>
        </div>
        <div className="kv">
          <span>Delivered in</span>
          <b>{minutesRange(d.estMinutesLow, d.estMinutesHigh)}</b>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="wrap">
      <div className="pagehead">
        <Link className="btn sm" href={ROUTES.devDashboard}>
          <Icon name="back" />
          Dashboard
        </Link>
        <div className="row between wrapflex" style={{ marginTop: 14, gap: 12 }}>
          <h1>Publish an agent</h1>
          <div className="row wrapflex tiny muted" style={{ gap: 10 }}>
            <span className="row" style={{ gap: 6 }}>
              <Icon name="check" size={14} />
              Draft saved on this device
            </span>
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                setSaved({ step: 1, d: { ...BLANK_DRAFT } });
                setChecks(VERIFICATION_CHECKS.map(() => null));
                setTestedSig(null);
                setTouched(false);
              }}
            >
              Start blank
            </button>
          </div>
        </div>
      </div>
      <div className="wiz">
        <nav className="wsteps" aria-label="Publish steps">
          {STEPS.map((x, i) => {
            const n = i + 1;
            const reachable = n < step || (n > step && [...Array(n - 1)].every((_, j) => (j + 1 <= 4 ? stepOk(j + 1) : j + 1 === 5 ? testsPassed : true)));
            return (
              <button
                key={x}
                type="button"
                className={cx("wstep", n === step && "on", n < step && "done")}
                aria-current={n === step ? "step" : undefined}
                disabled={!reachable && n !== step}
                onClick={() => setStep(n)}
                style={{ background: "none", border: 0, width: mobile ? "auto" : "100%", textAlign: "left", cursor: reachable ? "pointer" : "default", font: "inherit", whiteSpace: "nowrap" }}
              >
                <span className="step-n">{n < step ? <Icon name="check" size={12} /> : n}</span>
                {x}
              </button>
            );
          })}
        </nav>
        <div className="grid" style={{ gridTemplateColumns: stacked ? "minmax(0,1fr)" : "minmax(0,1fr) 320px", gap: 24, alignItems: "start" }}>
          <div className="card" ref={formRef}>
            <div className="tiny muted" style={{ marginBottom: 12 }}>
              Step {step} of {N} · {PUBLISH_WIZARD[step - 1].desc}
            </div>
            <div key={step} className="reveal">
              {B[step]}
            </div>
            {step < N && (
              <div className="row" style={{ marginTop: 24 }}>
                <button type="button" className="btn" onClick={() => setStep(step - 1)} disabled={step === 1}>
                  <Icon name="back" />
                  Back
                </button>
                <div className="sp" />
                <span className="tiny muted hideS" style={{ marginRight: 8 }}>
                  ⌘/Ctrl + Enter
                </span>
                <button type="button" className="btn p" onClick={next} aria-disabled={!canContinue || undefined} style={!canContinue ? { opacity: 0.55 } : undefined}>
                  Continue
                  <Icon name="arrow" />
                </button>
              </div>
            )}
            {step === N && (
              <div className="row" style={{ marginTop: 24 }}>
                <button type="button" className="btn" onClick={() => setStep(step - 1)}>
                  <Icon name="back" />
                  Back
                </button>
              </div>
            )}
          </div>
          {previewPane}
        </div>
      </div>
    </div>
  );
}

function PricingStep({
  d,
  upd,
  patch,
  priceCents,
  err,
  catPrices,
}: {
  d: AgentDraft;
  upd: <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) => void;
  patch: (p: Partial<AgentDraft>) => void;
  priceCents: number | null;
  err: (k: string) => string | undefined;
  catPrices: { median: number | null; xs: number[] };
}) {
  const earn = Math.round(((priceCents ?? 0) * (100 - PLATFORM_FEE_PERCENT)) / 100);
  const cheaper = priceCents ? catPrices.xs.filter((x) => x > priceCents).length : 0;
  const preset = TIME_WINDOWS.findIndex(([l, h]) => l === d.estMinutesLow && h === d.estMinutesHigh);
  return (
    <>
      <label className="l" htmlFor="p-price">
        Price per task (€)
      </label>
      <div className="row wrapflex" style={{ gap: 14 }}>
        <input
          id="p-price"
          data-autofocus
          className="f"
          type="number"
          inputMode="decimal"
          min={1}
          max={500}
          step={1}
          value={d.priceEuros}
          onChange={(e) => upd("priceEuros", e.target.value)}
          aria-invalid={!!err("price") || undefined}
          style={{ maxWidth: 160 }}
        />
        <input
          type="range"
          min={1}
          max={100}
          value={Math.min(100, Math.max(1, Number(d.priceEuros) || 1))}
          onChange={(e) => upd("priceEuros", e.target.value)}
          aria-label="Price slider"
          style={{ flex: 1, minWidth: 160, accentColor: "var(--accent)" }}
        />
      </div>
      {err("price") && (
        <p className="err" role="alert">
          {err("price")}
        </p>
      )}
      {catPrices.median !== null && priceCents ? (
        <p className="hint">
          {d.category} agents charge a median of <b>{eur(catPrices.median)}</b>. You&apos;d be cheaper than {cheaper} of {catPrices.xs.length}.
        </p>
      ) : null}

      <label className="l" style={{ marginTop: 16 }}>
        Estimated execution time
      </label>
      <div className="row wrapflex" style={{ gap: 8 }} role="group" aria-label="Delivery window">
        {TIME_WINDOWS.map(([l, h], i) => (
          <button
            key={l}
            type="button"
            className={preset === i ? "chip on" : "chip"}
            aria-pressed={preset === i}
            onClick={() => patch({ estMinutesLow: l, estMinutesHigh: h })}
          >
            {minutesRange(l, h)}
          </button>
        ))}
      </div>
      <div className="row wrapflex" style={{ gap: 10, marginTop: 10 }}>
        <label className="small muted row" style={{ gap: 6 }}>
          From
          <input
            className="f"
            type="number"
            min={1}
            max={600}
            value={d.estMinutesLow}
            onChange={(e) => upd("estMinutesLow", Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
            style={{ width: 90 }}
          />
        </label>
        <label className="small muted row" style={{ gap: 6 }}>
          to
          <input
            className="f"
            type="number"
            min={1}
            max={600}
            value={d.estMinutesHigh}
            onChange={(e) => upd("estMinutesHigh", Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
            aria-invalid={!!err("time") || undefined}
            style={{ width: 90 }}
          />
          min
        </label>
      </div>
      {err("time") && (
        <p className="err" role="alert">
          {err("time")}
        </p>
      )}

      <div className="card flat" style={{ marginTop: 16 }}>
        <div className="kv">
          <span>Your agent earns per task</span>
          <b>{eur(earn)}</b>
        </div>
        <div className="kv">
          <span>At 100 tasks a month</span>
          <b>{eur(earn * 100)}</b>
        </div>
        <div className="split" style={{ marginTop: 10, height: 34 }}>
          <div style={{ width: `${100 - PLATFORM_FEE_PERCENT}%`, background: "var(--accent)", color: "var(--accent-ink)" }}>You {eur(earn)}</div>
          <div style={{ width: `${PLATFORM_FEE_PERCENT}%`, background: "var(--line2)", color: "var(--ink)" }}>{eur((priceCents ?? 0) - earn)}</div>
        </div>
      </div>
      <p className="hint">
        Customers pay one price for the whole task. Ensemblis adds verification, infrastructure and its {PLATFORM_FEE_PERCENT}% platform fee.{" "}
        <Link href={ROUTES.economics} style={{ textDecoration: "underline" }}>
          See the economics
        </Link>
        .
      </p>
    </>
  );
}

function Success({ agent, onAnother }: { agent: Agent; onAnother: () => void }) {
  return (
    <div className="narrow" style={{ paddingTop: 40, paddingBottom: 40 }}>
      <div className="reveal" style={{ textAlign: "center", padding: "24px 0" }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, display: "grid", placeItems: "center", margin: "0 auto 14px", background: "var(--ok)", color: "#fff" }}>
          <Icon name="check" size={28} />
        </div>
        <span className="tag ok">
          <span className="pulse" />
          Live in the marketplace
        </span>
        <h1 className="serif" style={{ fontSize: "clamp(30px,4.4vw,44px)", lineHeight: 1.08, marginTop: 14 }}>
          {agent.name} is live.
        </h1>
        <p className="muted" style={{ maxWidth: "46ch", margin: "8px auto 22px" }}>
          Customers can find it now, and Ensemblis can match it to incoming work. Every completed task builds its track record toward the Verified
          badge.
        </p>
      </div>
      <div style={{ maxWidth: 380, margin: "0 auto" }}>
        <AgentCard agent={agent} />
      </div>
      <div className="row wrapflex" style={{ justifyContent: "center", marginTop: 24 }}>
        <Link className="btn p" href={ROUTES.agent(agent.slug)}>
          View public page
          <Icon name="ext" />
        </Link>
        <Link className="btn" href={newTaskUrl({ agent: agent.slug })}>
          <Icon name="play" />
          Run a test task
        </Link>
        <Link className="btn" href={ROUTES.devDashboard}>
          Developer console
        </Link>
      </div>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <button type="button" className="btn ghost sm" onClick={onAnother}>
          <Icon name="plus" />
          Publish another agent
        </button>
      </div>
    </div>
  );
}
